-- 5단계: 상환 장부(부분 상환), 여러 명 정산(묶음), 분할 회차 알림

-- 여러 명 정산: 한 번에 만든 약속들을 하나로 묶는 값
alter table public.promises add column group_id uuid;
create index promises_group_idx on public.promises (group_id) where group_id is not null;

-- 분할 이행 회차별 알림 기록: (약속, 기한 버전, 회차, 단계)마다 한 번
create table public.installment_reminders (
  promise_id uuid not null references public.promises (id) on delete cascade,
  deadline_version integer not null,
  installment_no integer not null,
  stage smallint not null check (stage between 1 and 3),
  created_at timestamptz not null default now(),
  primary key (promise_id, deadline_version, installment_no, stage)
);
alter table public.installment_reminders enable row level security;
revoke all on public.installment_reminders from anon, authenticated;
grant all on public.installment_reminders to service_role;
grant select on public.installment_reminders to authenticated;
create policy inst_rem_party on public.installment_reminders for select to authenticated using (private.is_party(promise_id));

create function public.keep_installment_mark(p_promise uuid, p_dv integer, p_no integer, p_stage integer) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.installment_reminders (promise_id, deadline_version, installment_no, stage) values (p_promise, p_dv, p_no, p_stage)
  on conflict do nothing;
  return found;
end $$;

-- 약속 생성에 group_id 추가
create or replace function public.keep_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ev jsonb := p -> 'event';
begin
  insert into public.promises (id, share_code, template, title, amount, interest_rate, late_interest_rate, repay_account,
    item, task, deadline, method, penalty, memo, installments, amendments, status, current_hash, canonical_version,
    legacy_doc, is_demo, done_at, group_id, created_by, created_at)
  select coalesce(r.id, gen_random_uuid()), r.share_code, r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account,
    r.item, r.task, r.deadline, r.method, r.penalty, r.memo, coalesce(r.installments, '[]'), coalesce(r.amendments, '[]'),
    r.status, r.current_hash, coalesce(r.canonical_version, 3), r.legacy_doc, coalesce(r.is_demo, false), r.done_at, r.group_id, r.created_by,
    coalesce(r.created_at, now())
  from jsonb_populate_record(null::public.promises, p -> 'promise') r
  returning id into v_id;

  insert into public.parties (promise_id, role, user_id, display_name, signature_path, signature_sha256, signed_at,
    signer_ip, signer_ua, consent_at, consent_version)
  select v_id, r.role, r.user_id, r.display_name, r.signature_path, r.signature_sha256, r.signed_at,
    r.signer_ip, r.signer_ua, r.consent_at, r.consent_version
  from jsonb_array_elements(p -> 'parties') e,
       lateral jsonb_populate_record(null::public.parties, e) r;

  if v_ev is not null then
    insert into public.events (promise_id, actor_role, type, payload, canon, sim_at)
    values (v_id, v_ev ->> 'actor_role', v_ev ->> 'type', (v_ev ->> 'canon')::jsonb, v_ev ->> 'canon', (v_ev ->> 'sim_at')::date);
  end if;

  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

-- 크론 대상에 분할 회차 포함
create or replace function public.keep_cron_candidates(p_promise uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pr.id, 'share_code', pr.share_code, 'template', pr.template, 'title', pr.title, 'amount', pr.amount,
    'item', pr.item, 'task', pr.task, 'deadline', pr.deadline, 'deadline_version', pr.deadline_version,
    'status', pr.status, 'is_demo', pr.is_demo, 'installments', pr.installments, 'demo_offset_days', pr.demo_offset_days,
    'parties', (select jsonb_agg(jsonb_build_object('role', p.role, 'user_id', p.user_id, 'display_name', p.display_name)) from public.parties p where p.promise_id = pr.id),
    'done_stages', coalesce((select jsonb_agg(n.stage) from public.nudges n where n.promise_id = pr.id and n.deadline_version = pr.deadline_version), '[]'::jsonb)
  )), '[]'::jsonb)
  from public.promises pr
  where pr.status in ('active', 'reported') and pr.deadline is not null
    and (p_promise is null or pr.id = p_promise);
$$;

-- 상환 기록: A가 직접 받은 금액을 기록할 때 바로 '확인됨'으로 넣을 수 있게
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
    insert into public.payments (promise_id, amount, paid_on, installment_no, note, proof_path, ai_reading, confirmed_by_a, answered_at)
    select v_id, r.amount, r.paid_on, r.installment_no, r.note, r.proof_path, r.ai_reading, r.confirmed_by_a,
           case when r.confirmed_by_a is not null then now() end
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

revoke all on function public.keep_installment_mark(uuid, integer, integer, integer), public.keep_create(jsonb),
  public.keep_cron_candidates(uuid), public.keep_commit(jsonb) from public, anon, authenticated;
grant execute on function public.keep_installment_mark(uuid, integer, integer, integer), public.keep_create(jsonb),
  public.keep_cron_candidates(uuid), public.keep_commit(jsonb) to service_role;
