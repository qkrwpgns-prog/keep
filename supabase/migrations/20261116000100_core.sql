-- 키프 1단계: 핵심 스키마 · RLS · 이벤트 해시 체인 · 상태 변경 함수
-- 원칙
--  1) 클라이언트(anon/authenticated)는 읽기만 한다. 쓰기는 Edge Function(service_role)이 keep_* 함수로만 한다.
--  2) events는 INSERT만. 해시는 DB 트리거가 계산하므로 어떤 경로로 넣어도 체인이 이어진다.
--  3) 약속과 하위 데이터는 parties.user_id = auth.uid() 인 당사자만 읽는다.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  notify_email text check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notify_push boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, notify_email)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'nickname',
                  new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name',
                  split_part(coalesce(new.email, ''), '@', 1)), 40),
    nullif(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------- promises
create table public.promises (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique check (share_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  template text not null check (template in ('loan', 'lend', 'pledge', 'team', 'split')),
  title text not null check (char_length(title) between 1 and 80),
  amount bigint check (amount is null or amount > 0),
  interest_rate numeric(5, 2) check (interest_rate is null or (interest_rate >= 0 and interest_rate <= 20)),
  late_interest_rate numeric(5, 2) check (late_interest_rate is null or (late_interest_rate >= 0 and late_interest_rate <= 20)),
  repay_account text check (char_length(repay_account) <= 80),
  item text check (char_length(item) <= 200),
  task text check (char_length(task) <= 500),
  deadline date,
  method text check (char_length(method) <= 100),
  penalty text check (char_length(penalty) <= 200),
  memo text check (char_length(memo) <= 500),
  installments jsonb not null default '[]'::jsonb check (jsonb_typeof(installments) = 'array'),
  amendments jsonb not null default '[]'::jsonb check (jsonb_typeof(amendments) = 'array'),
  status text not null default 'draft'
    check (status in ('draft', 'pending_b', 'revise', 'active', 'reported', 'done', 'cancelled', 'declined')),
  revise_note text check (char_length(revise_note) <= 500),
  current_hash text,
  canonical_version smallint not null default 3,
  legacy_doc jsonb,
  deadline_version integer not null default 1,
  version integer not null default 1,
  is_demo boolean not null default false,
  demo_offset_days integer,
  done_at timestamptz,
  retain_until date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index promises_created_by_idx on public.promises (created_by);
create unique index promises_legacy_once on public.promises (created_by, (legacy_doc ->> 'id')) where legacy_doc is not null;
create index promises_deadline_idx on public.promises (deadline) where status in ('active', 'reported');

-- ---------------------------------------------------------------- parties
create table public.parties (
  promise_id uuid not null references public.promises (id) on delete cascade,
  role text not null check (role in ('A', 'B')),
  user_id uuid references auth.users (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  signature_path text,
  signature_sha256 text,
  signed_at timestamptz,
  signer_ip text,
  signer_ua text,
  consent_at timestamptz,
  consent_version text,
  primary key (promise_id, role)
);
create index parties_user_idx on public.parties (user_id);

-- ---------------------------------------------------------------- events (append-only, hash chain)
create table public.events (
  id bigserial primary key,
  promise_id uuid not null references public.promises (id) on delete cascade,
  actor_role text not null check (actor_role in ('A', 'B', 'system')),
  type text not null check (type ~ '^[a-z_]{2,32}$'),
  payload jsonb not null default '{}'::jsonb,
  canon text not null,               -- payload의 JCS 문자열(해시 입력값 그대로 보관)
  created_at timestamptz not null default now(),
  sim_at date,                        -- 시연 모드에서 되감은 날짜(실제 시각은 created_at)
  prev_hash text,
  hash text not null
);
create index events_promise_idx on public.events (promise_id, id);

create function private.events_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_prev text;
begin
  if new.canon::jsonb is distinct from new.payload then
    raise exception 'events.canon과 payload가 다릅니다' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.promise_id::text, 0));
  select e.hash into v_prev from public.events e where e.promise_id = new.promise_id order by e.id desc limit 1;
  new.prev_hash := v_prev;
  new.created_at := date_trunc('milliseconds', clock_timestamp());
  new.hash := encode(sha256(convert_to(
    coalesce(v_prev, '') || new.canon || to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'UTF8')), 'hex');
  return new;
end $$;
create trigger events_chain before insert on public.events
  for each row execute function private.events_chain();

create function private.events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 탈퇴 처리처럼 약속 자체를 지울 때만(keep_delete_account 안에서) 허용
  if tg_op = 'DELETE' and current_setting('keep.allow_event_purge', true) = 'on' then
    return old;
  end if;
  raise exception '증거 기록(events)은 수정하거나 지울 수 없습니다' using errcode = '42501';
end $$;
create trigger events_no_update before update or delete on public.events
  for each row execute function private.events_immutable();
create trigger events_no_truncate before truncate on public.events
  for each statement execute function private.events_immutable();

-- ---------------------------------------------------------------- requests / payments / push
create table public.requests (
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null references public.promises (id) on delete cascade,
  kind text not null check (kind in ('extend', 'split')),
  new_deadline date,
  installments jsonb check (installments is null or jsonb_typeof(installments) = 'array'),
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index requests_promise_idx on public.requests (promise_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  promise_id uuid not null references public.promises (id) on delete cascade,
  amount bigint check (amount is null or amount > 0),
  paid_on date,
  installment_no integer,
  note text check (char_length(note) <= 300),
  proof_path text,
  ai_reading jsonb,
  confirmed_by_a boolean,            -- null=확인 대기, true=확인, false=확인 못함
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index payments_promise_idx on public.payments (promise_id);

create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
create index push_user_idx on public.push_subscriptions (user_id);

-- 공개 미리보기 속도 제한
create table private.rate_hits (
  key text not null,
  bucket timestamptz not null,
  hits integer not null default 0,
  primary key (key, bucket)
);

-- ---------------------------------------------------------------- 권한
-- Supabase 기본 권한(anon/authenticated에 전체 권한)을 걷어내고 필요한 것만 다시 준다.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;

alter table public.profiles enable row level security;
alter table public.promises enable row level security;
alter table public.parties enable row level security;
alter table public.events enable row level security;
alter table public.requests enable row level security;
alter table public.payments enable row level security;
alter table public.push_subscriptions enable row level security;

create function private.is_party(p_promise uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.parties p where p.promise_id = p_promise and p.user_id = auth.uid());
$$;
grant execute on function private.is_party(uuid) to authenticated;
grant usage on schema private to authenticated;

-- profiles: 본인만
grant select, update (display_name, notify_email, notify_push) on public.profiles to authenticated;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- promises 및 하위: 당사자만 읽기 (쓰기 정책 없음 = 쓰기 불가)
grant select on public.promises to authenticated;
create policy promises_party_select on public.promises for select to authenticated using (private.is_party(id));

-- parties: IP·UA·서명 파일 경로는 열 권한에서 제외 (증거 묶음 내보내기에서만 서버가 제공)
grant select (promise_id, role, user_id, display_name, signature_sha256, signed_at, consent_at) on public.parties to authenticated;
create policy parties_party_select on public.parties for select to authenticated using (private.is_party(promise_id));

grant select on public.events to authenticated;
create policy events_party_select on public.events for select to authenticated using (private.is_party(promise_id));

grant select on public.requests to authenticated;
create policy requests_party_select on public.requests for select to authenticated using (private.is_party(promise_id));

grant select (id, promise_id, amount, paid_on, installment_no, note, ai_reading, confirmed_by_a, created_at, answered_at)
  on public.payments to authenticated;
create policy payments_party_select on public.payments for select to authenticated using (private.is_party(promise_id));

grant select, insert, delete on public.push_subscriptions to authenticated;
create policy push_self on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- 서버 전용 함수 (service_role만 실행)

-- 약속 + 당사자 + 진행 데이터를 한 번에
create function public.keep_snapshot(p_id uuid default null, p_code text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v public.promises;
begin
  if p_id is not null then
    select * into v from public.promises where id = p_id;
  else
    select * into v from public.promises where share_code = upper(p_code);
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'promise', to_jsonb(v),
    'parties', coalesce((select jsonb_agg(to_jsonb(p) order by p.role) from public.parties p where p.promise_id = v.id), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.requests r where r.promise_id = v.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.payments x where x.promise_id = v.id), '[]'::jsonb)
  );
end $$;

-- 새 약속(작성자 서명 포함) 생성
create function public.keep_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ev jsonb := p -> 'event';
begin
  insert into public.promises (id, share_code, template, title, amount, interest_rate, late_interest_rate, repay_account,
    item, task, deadline, method, penalty, memo, installments, amendments, status, current_hash, canonical_version,
    legacy_doc, is_demo, done_at, created_by, created_at)
  select coalesce(r.id, gen_random_uuid()), r.share_code, r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account,
    r.item, r.task, r.deadline, r.method, r.penalty, r.memo, coalesce(r.installments, '[]'), coalesce(r.amendments, '[]'),
    r.status, r.current_hash, coalesce(r.canonical_version, 3), r.legacy_doc, coalesce(r.is_demo, false), r.done_at, r.created_by,
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

-- 상태 변경 한 건을 한 트랜잭션으로: 버전 확인 → 약속·당사자·요청·상환 갱신 → 이벤트 추가
create function public.keep_commit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := (p ->> 'promise_id')::uuid;
  v_row public.promises;
  v_party jsonb;
  v_ev jsonb := p -> 'event';
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

  update public.promises t set
    (template, title, amount, interest_rate, late_interest_rate, repay_account, item, task, deadline, method,
     penalty, memo, installments, amendments, status, revise_note, current_hash, canonical_version, deadline_version,
     done_at, retain_until)
    = (select r.template, r.title, r.amount, r.interest_rate, r.late_interest_rate, r.repay_account, r.item, r.task,
        r.deadline, r.method, r.penalty, r.memo, r.installments, r.amendments, r.status, r.revise_note, r.current_hash,
        r.canonical_version, r.deadline_version, r.done_at, r.retain_until
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

-- 고정 창 속도 제한: 허용되면 true
create function public.keep_rate_check(p_key text, p_limit integer, p_window_sec integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_bucket timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
        v_hits integer;
begin
  insert into private.rate_hits (key, bucket, hits) values (p_key, v_bucket, 1)
  on conflict (key, bucket) do update set hits = private.rate_hits.hits + 1
  returning hits into v_hits;
  delete from private.rate_hits where bucket < now() - interval '1 day';
  return v_hits <= p_limit;
end $$;

-- 최근 N일 안에 만든 '이자 있는 차용증' 수 (미등록 대부업 안내용)
create function public.keep_count_interest_loans(p_user uuid, p_days integer) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.promises
  where created_by = p_user and template = 'loan' and coalesce(interest_rate, 0) > 0
    and created_at > now() - make_interval(days => p_days) and not is_demo;
$$;

revoke all on function public.keep_snapshot(uuid, text), public.keep_create(jsonb), public.keep_commit(jsonb),
  public.keep_rate_check(text, integer, integer), public.keep_count_interest_loans(uuid, integer) from public, anon, authenticated;
grant execute on function public.keep_snapshot(uuid, text), public.keep_create(jsonb), public.keep_commit(jsonb),
  public.keep_rate_check(text, integer, integer), public.keep_count_interest_loans(uuid, integer) to service_role;
