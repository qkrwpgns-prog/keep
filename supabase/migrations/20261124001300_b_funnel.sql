-- B 진입 퍼널: 서명 요청 링크를 받은 사람이 어느 단계에서 멈추는지
--  약속마다 단계별 첫 도달 시각과 횟수만 남긴다(누가·어디서는 기록하지 않음). 약속이 지워지면 함께 지워진다.
--  view(링크 열어 미리보기) → otp(동의하고 인증 코드 요청) → login(로그인 완료) → joined(연결, events) → signed(서명, events)

create table public.funnel_steps (
  promise_id uuid not null references public.promises (id) on delete cascade,
  step text not null check (step in ('view', 'otp', 'login')),
  first_at timestamptz not null default now(),
  count integer not null default 1,
  primary key (promise_id, step)
);
alter table public.funnel_steps enable row level security;
revoke all on public.funnel_steps from anon, authenticated;
grant all on public.funnel_steps to service_role;

create function public.keep_funnel_mark(p_promise uuid, p_step text) returns void
language sql security definer set search_path = '' as $$
  insert into public.funnel_steps (promise_id, step) values (p_promise, p_step)
  on conflict (promise_id, step) do update set count = least(public.funnel_steps.count + 1, 1000000);
$$;

-- 최근 p_days일에 만든 약속(시연·가져온 기록 제외)의 단계별 도달 수.
-- 뒤 단계에 도달했으면 앞 단계도 지난 것으로 센다(이미 로그인한 사람은 otp·login 기록이 없으므로)
create function public.keep_funnel_stats(p_days integer default 30) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select pr.id, pr.created_at,
      exists (select 1 from public.funnel_steps f where f.promise_id = pr.id and f.step = 'view') as v,
      exists (select 1 from public.funnel_steps f where f.promise_id = pr.id and f.step = 'otp') as o,
      exists (select 1 from public.funnel_steps f where f.promise_id = pr.id and f.step = 'login') as l,
      (select min(e.created_at) from public.events e where e.promise_id = pr.id and e.type = 'joined') as joined_at,
      (select min(e.created_at) from public.events e where e.promise_id = pr.id and e.type = 'signed') as signed_at,
      exists (select 1 from public.events e where e.promise_id = pr.id and e.type = 'revise_requested') as rv,
      exists (select 1 from public.events e where e.promise_id = pr.id and e.type = 'declined') as dc
    from public.promises pr
    where not pr.is_demo and pr.legacy_doc is null
      and pr.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)))
  ), s as (
    select *, signed_at is not null as sg, joined_at is not null or signed_at is not null as jn from base
  )
  select jsonb_build_object(
    'days', p_days,
    'created', count(*),
    'viewed', count(*) filter (where v or o or l or jn),
    'otp', count(*) filter (where o or l or jn),
    'login', count(*) filter (where l or jn),
    'joined', count(*) filter (where jn),
    'signed', count(*) filter (where sg),
    'revise', count(*) filter (where rv),
    'declined', count(*) filter (where dc),
    'median_hours_to_sign', round((percentile_cont(0.5) within group (order by extract(epoch from signed_at - created_at) / 3600.0)
                              filter (where sg))::numeric, 1)
  ) from s;
$$;

revoke all on function public.keep_funnel_mark(uuid, text), public.keep_funnel_stats(integer) from public, anon, authenticated;
grant execute on function public.keep_funnel_mark(uuid, text), public.keep_funnel_stats(integer) to service_role;
