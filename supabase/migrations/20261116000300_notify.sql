-- 2단계: 알림과 재촉
--  · nudges: 단계별 알림·재촉 기록. (약속, 기한 버전, 단계)마다 한 줄 → 같은 단계는 두 번 보낼 수 없다(DB가 보장)
--      1·2단계(D-3, D-day): B에게 자동 알림(status=auto_sent)
--      3·4·5단계(D+3, D+7, D+14): A에게 "재촉할 때예요"(prompted) → A가 승인하면 B에게 발송(sent)
--  · notifications: 발송 큐. 밤 21시~아침 9시(KST)에는 send_after를 다음 날 9시로 미룬다
--  · notification_prefs: B가 약속별로 알림 끄기 / abuse_reports: 약속별 신고

alter table public.profiles add column notify_email_on boolean not null default true;
grant update (notify_email_on) on public.profiles to authenticated;

-- 서버 전용 설정(크론 호출 비밀값, 프로젝트 주소). private 스키마는 클라이언트에 노출되지 않는다
create table private.settings (key text primary key, value text not null);
insert into private.settings (key, value) values
  ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')),
  ('project_url', 'https://gwtpmwzxbxoujckhbttc.supabase.co')
on conflict (key) do nothing;

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null references public.promises (id) on delete cascade,
  deadline_version integer not null,
  stage smallint not null check (stage between 1 and 5),
  status text not null check (status in ('auto_sent', 'prompted', 'sent')),
  message text check (char_length(message) <= 4000),
  tone smallint check (tone between 1 and 5),
  relation text check (char_length(relation) <= 10),
  ai_used boolean not null default false,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (promise_id, deadline_version, stage)
);

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  promise_id uuid references public.promises (id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  kind text not null,
  title text not null,
  body text not null,
  url text,
  send_after timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_due_idx on public.notifications (send_after) where status = 'queued';
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.notification_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  promise_id uuid not null references public.promises (id) on delete cascade,
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, promise_id)
);

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null references public.promises (id) on delete cascade,
  reporter uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

-- 권한·RLS
revoke all on public.nudges, public.notifications, public.notification_prefs, public.abuse_reports from anon, authenticated;
revoke all on sequence public.notifications_id_seq from anon, authenticated;
grant all on public.nudges, public.notifications, public.notification_prefs, public.abuse_reports to service_role;
grant all on sequence public.notifications_id_seq to service_role;
grant all on private.settings to service_role;
alter table public.nudges enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.abuse_reports enable row level security;

grant select on public.nudges to authenticated;
create policy nudges_party_select on public.nudges for select to authenticated using (private.is_party(promise_id));

grant select (id, promise_id, channel, kind, title, body, url, send_after, status, created_at, sent_at) on public.notifications to authenticated;
create policy notifications_self_select on public.notifications for select to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.notification_prefs to authenticated;
create policy prefs_self on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.is_party(promise_id));

-- ---------------------------------------------------------------- 서버 전용 함수

create function public.keep_check_cron_secret(p_secret text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.settings where key = 'cron_secret' and value = p_secret and length(p_secret) >= 32);
$$;

-- 매일 크론 대상: 진행 중인 약속과 당사자, 이번 기한 버전에서 이미 처리한 단계
create function public.keep_cron_candidates(p_promise uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id, 'share_code', pr.share_code, 'template', pr.template, 'title', pr.title, 'amount', pr.amount,
    'item', pr.item, 'task', pr.task, 'deadline', pr.deadline, 'deadline_version', pr.deadline_version,
    'status', pr.status, 'is_demo', pr.is_demo, 'demo_offset_days', pr.demo_offset_days,
    'parties', (select jsonb_agg(jsonb_build_object('role', p.role, 'user_id', p.user_id, 'display_name', p.display_name)) from public.parties p where p.promise_id = pr.id),
    'done_stages', coalesce((select jsonb_agg(n.stage) from public.nudges n where n.promise_id = pr.id and n.deadline_version = pr.deadline_version), '[]'::jsonb)
  )), '[]'::jsonb)
  from public.promises pr
  where pr.status in ('active', 'reported') and pr.deadline is not null
    and (p_promise is null or pr.id = p_promise);
$$;

-- 단계 기록(자동 알림·재촉 안내). 이미 있으면 false
create function public.keep_nudge_mark(p_promise uuid, p_dv integer, p_stage integer, p_status text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.nudges (promise_id, deadline_version, stage, status) values (p_promise, p_dv, p_stage, p_status)
  on conflict (promise_id, deadline_version, stage) do nothing;
  return found;
end $$;

-- 알림 큐에 넣기: 사용자 설정(푸시·이메일 켜짐, 구독 여부)과 약속별 알림 끄기를 반영
create function public.keep_enqueue(p jsonb) returns bigint[]
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (p ->> 'user_id')::uuid;
  v_promise uuid := (p ->> 'promise_id')::uuid;
  v_prof public.profiles;
  v_ids bigint[] := '{}';
  v_id bigint;
begin
  if v_user is null then return v_ids; end if;
  select * into v_prof from public.profiles where id = v_user and deleted_at is null;
  if not found then return v_ids; end if;
  if coalesce((p ->> 'respect_mute')::boolean, true) and v_promise is not null
     and exists (select 1 from public.notification_prefs where user_id = v_user and promise_id = v_promise and muted) then
    return v_ids;
  end if;
  if v_prof.notify_push and exists (select 1 from public.push_subscriptions where user_id = v_user) then
    insert into public.notifications (user_id, promise_id, channel, kind, title, body, url, send_after)
    values (v_user, v_promise, 'push', p ->> 'kind', p ->> 'title', p ->> 'body', p ->> 'url', coalesce((p ->> 'send_after')::timestamptz, now()))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  if v_prof.notify_email_on and v_prof.notify_email is not null then
    insert into public.notifications (user_id, promise_id, channel, kind, title, body, url, send_after)
    values (v_user, v_promise, 'email', p ->> 'kind', p ->> 'title', coalesce(p ->> 'email_body', p ->> 'body'), p ->> 'url', coalesce((p ->> 'send_after')::timestamptz, now()))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  return v_ids;
end $$;

-- 보낼 차례인 알림을 가져와 'sending'으로 잠근다(동시 실행돼도 한 번만 발송)
create function public.keep_claim_due(p_limit integer default 50, p_ids bigint[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  with due as (
    select n.id from public.notifications n
    where n.status = 'queued' and n.send_after <= now() and (p_ids is null or n.id = any (p_ids))
    order by n.id for update skip locked limit p_limit
  ), upd as (
    update public.notifications n set status = 'sending', attempts = n.attempts + 1
    from due where n.id = due.id returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'user_id', u.user_id, 'promise_id', u.promise_id, 'channel', u.channel, 'kind', u.kind,
    'title', u.title, 'body', u.body, 'url', u.url,
    'email', (select pf.notify_email from public.profiles pf where pf.id = u.user_id),
    'subs', case when u.channel = 'push' then (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys)), '[]'::jsonb) from public.push_subscriptions s where s.user_id = u.user_id) end
  ) order by u.id), '[]'::jsonb) into v from upd u;
  -- 오래 'sending'에 머문 것(함수가 중간에 죽은 경우)은 다시 대기열로
  update public.notifications set status = 'queued' where status = 'sending' and attempts < 3 and created_at < now() - interval '30 minutes' and sent_at is null
    and id not in (select (e ->> 'id')::bigint from jsonb_array_elements(v) e);
  return v;
end $$;

create function public.keep_finish_notification(p_id bigint, p_status text, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.notifications set
    status = case when p_status = 'failed' and attempts < 3 then 'queued' else p_status end,
    send_after = case when p_status = 'failed' then now() + interval '10 minutes' else send_after end,
    error = left(p_error, 300),
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id;
$$;

create function public.keep_drop_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- 시스템 이벤트(자동 알림 발송 등)를 증거 기록에 남김. 버전은 올리지 않는다(사용자 동작과 충돌하지 않게)
create function public.keep_system_event(p_promise uuid, p_type text, p_canon text, p_sim_at date default null) returns text
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  insert into public.events (promise_id, actor_role, type, payload, canon, sim_at)
  values (p_promise, 'system', p_type, p_canon::jsonb, p_canon, p_sim_at) returning hash into v_hash;
  return v_hash;
end $$;

-- 신고
create function public.keep_abuse_report(p_promise uuid, p_user uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into public.abuse_reports (promise_id, reporter, reason) values (p_promise, p_user, p_reason);
$$;

-- 보존 기한이 지난 약속 파기(탈퇴 정책 (가)) → 지운 서명 파일 경로를 돌려줌
create function public.keep_purge_expired() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(p.signature_path), '[]'::jsonb) into v
  from public.parties p join public.promises pr on pr.id = p.promise_id
  where pr.retain_until < (now() at time zone 'Asia/Seoul')::date and p.signature_path is not null;
  perform set_config('keep.allow_event_purge', 'on', true);
  delete from public.promises where retain_until < (now() at time zone 'Asia/Seoul')::date;
  perform set_config('keep.allow_event_purge', 'off', true);
  delete from public.notifications where created_at < now() - interval '90 days';
  return v;
end $$;

-- keep_commit에 '재촉 발송' 추가: 같은 단계는 두 번 보낼 수 없다
create or replace function public.keep_commit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p ->> 'promise_id')::uuid;
  v_row public.promises;
  v_party jsonb;
  v_ev jsonb := p -> 'event';
  v_ns jsonb := p -> 'nudge_send';
  v_hash text;
begin
  select * into v_row from public.promises where id = v_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.version <> (p ->> 'version')::int then
    raise exception 'VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p ? 'expect_status' and not (v_row.status = any (array(select jsonb_array_elements_text(p -> 'expect_status')))) then
    raise exception 'BAD_STATUS:%', v_row.status using errcode = '55000';
  end if;

  if v_ns is not null then
    insert into public.nudges (promise_id, deadline_version, stage, status, message, tone, relation, ai_used, sent_at)
    values (v_id, v_row.deadline_version, (v_ns ->> 'stage')::int, 'sent', v_ns ->> 'message', (v_ns ->> 'tone')::int,
            v_ns ->> 'relation', coalesce((v_ns ->> 'ai_used')::boolean, false), now())
    on conflict (promise_id, deadline_version, stage) do update
      set status = 'sent', message = excluded.message, tone = excluded.tone, relation = excluded.relation,
          ai_used = excluded.ai_used, sent_at = excluded.sent_at
      where public.nudges.status <> 'sent';
    if not found then raise exception 'NUDGE_ALREADY_SENT' using errcode = '23505'; end if;
  end if;

  update public.promises t set
    (template, title, amount, interest_rate, late_interest_rate, repay_account, item, task, deadline, method,
     penalty, memo, installments, amendments, status, revise_note, current_hash, canonical_version, deadline_version,
     done_at, retain_until, is_demo, demo_offset_days)
    = (select r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account, r.item, r.task,
        r.deadline, r.method, r.penalty, r.memo, r.installments, r.amendments, r.status, r.revise_note, r.current_hash,
        r.canonical_version, r.deadline_version, r.done_at, r.retain_until, r.is_demo, r.demo_offset_days
       from jsonb_populate_record(t, coalesce(p -> 'patch', '{}'::jsonb)) r),
    version = t.version + 1,
    updated_at = now()
  where t.id = v_id;

  for v_party in select * from jsonb_array_elements(coalesce(p -> 'parties', '[]'::jsonb)) loop
    update public.parties t set
      (user_id, display_name, signature_path, signature_sha256, signed_at, signer_ip, signer_ua, consent_at, consent_version)
      = (select r.user_id, r.display_name, r.signature_path, r.signature_sha256, r.signed_at, r.signer_ip, r.signer_ua,
          r.consent_at, r.consent_version
         from jsonb_populate_record(t, v_party) r)
    where t.promise_id = v_id and t.role = v_party ->> 'role';
  end loop;

  if p ? 'request_insert' then
    insert into public.requests (promise_id, kind, new_deadline, installments, note)
    select v_id, r.kind, r.new_deadline, r.installments, r.note
    from jsonb_populate_record(null::public.requests, p -> 'request_insert') r;
  end if;
  if p ? 'request_update' then
    update public.requests t set status = p -> 'request_update' ->> 'status', answered_at = now()
    where t.id = (p -> 'request_update' ->> 'id')::uuid and t.promise_id = v_id and t.status = 'pending';
    if not found then raise exception 'REQUEST_NOT_PENDING' using errcode = '55000'; end if;
  end if;
  if p ? 'payment_insert' then
    insert into public.payments (promise_id, amount, paid_on, installment_no, note, proof_path, ai_reading)
    select v_id, r.amount, r.paid_on, r.installment_no, r.note, r.proof_path, r.ai_reading
    from jsonb_populate_record(null::public.payments, p -> 'payment_insert') r;
  end if;
  if p ? 'payment_update' then
    update public.payments t set confirmed_by_a = (p -> 'payment_update' ->> 'confirmed_by_a')::boolean, answered_at = now()
    where t.id = (p -> 'payment_update' ->> 'id')::uuid and t.promise_id = v_id and t.confirmed_by_a is null;
    if not found then raise exception 'PAYMENT_NOT_PENDING' using errcode = '55000'; end if;
  end if;

  if v_ev is not null then
    insert into public.events (promise_id, actor_role, type, payload, canon, sim_at)
    values (v_id, v_ev ->> 'actor_role', v_ev ->> 'type', (v_ev ->> 'canon')::jsonb, v_ev ->> 'canon', (v_ev ->> 'sim_at')::date)
    returning hash into v_hash;
  end if;

  return jsonb_build_object('version', v_row.version + 1, 'event_hash', v_hash);
end $$;

revoke all on function public.keep_check_cron_secret(text), public.keep_cron_candidates(uuid), public.keep_nudge_mark(uuid, integer, integer, text),
  public.keep_enqueue(jsonb), public.keep_claim_due(integer, bigint[]), public.keep_finish_notification(bigint, text, text),
  public.keep_drop_subscription(text), public.keep_system_event(uuid, text, text, date), public.keep_abuse_report(uuid, uuid, text),
  public.keep_purge_expired(), public.keep_commit(jsonb) from public, anon, authenticated;
grant execute on function public.keep_check_cron_secret(text), public.keep_cron_candidates(uuid), public.keep_nudge_mark(uuid, integer, integer, text),
  public.keep_enqueue(jsonb), public.keep_claim_due(integer, bigint[]), public.keep_finish_notification(bigint, text, text),
  public.keep_drop_subscription(text), public.keep_system_event(uuid, text, text, date), public.keep_abuse_report(uuid, uuid, text),
  public.keep_purge_expired(), public.keep_commit(jsonb) to service_role;
