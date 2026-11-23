-- 서비스 전체 AI 하루 한도: 계정을 여러 개 만들어 Claude API 비용을 키우는 것을 막는다
create table public.ai_usage_global (
  day date primary key,
  count integer not null default 0
);
alter table public.ai_usage_global enable row level security;
revoke all on public.ai_usage_global from anon, authenticated;
grant all on public.ai_usage_global to service_role;

-- 결과: ok | user(내 하루 한도 초과) | global(서비스 전체 한도 초과). 넘으면 아무것도 늘리지 않는다
create function public.keep_ai_take_v2(p_user uuid, p_limit integer, p_global integer) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Seoul')::date;
  v_g integer;
  v_u integer;
begin
  insert into public.ai_usage_global (day, count) values (v_day, 1)
  on conflict (day) do update set count = public.ai_usage_global.count + 1
  returning count into v_g;
  if v_g > p_global then
    update public.ai_usage_global set count = count - 1 where day = v_day;
    return 'global';
  end if;
  insert into public.ai_usage (user_id, day, count) values (p_user, v_day, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into v_u;
  if v_u > p_limit then
    update public.ai_usage set count = count - 1 where user_id = p_user and day = v_day;
    update public.ai_usage_global set count = count - 1 where day = v_day;
    return 'user';
  end if;
  return 'ok';
end $$;
revoke all on function public.keep_ai_take_v2(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.keep_ai_take_v2(uuid, integer, integer) to service_role;
