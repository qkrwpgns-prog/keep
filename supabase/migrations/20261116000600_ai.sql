-- 3단계: AI 호출 한도(사용자당 하루 N회, KST 날짜 기준)
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
grant all on public.ai_usage to service_role;
grant select on public.ai_usage to authenticated;
create policy ai_usage_self on public.ai_usage for select to authenticated using (user_id = auth.uid());

-- 한 번 쓸 수 있으면 1 늘리고 true, 한도를 넘으면 false
create function public.keep_ai_take(p_user uuid, p_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into public.ai_usage (user_id, day, count) values (p_user, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
  returning count into v;
  if v > p_limit then
    update public.ai_usage set count = count - 1 where user_id = p_user and day = (now() at time zone 'Asia/Seoul')::date;
    return false;
  end if;
  return true;
end $$;
revoke all on function public.keep_ai_take(uuid, integer) from public, anon, authenticated;
grant execute on function public.keep_ai_take(uuid, integer) to service_role;

-- 스냅샷에 재촉 기록도 담는다(AI 재촉 문구가 이전 메시지를 반복하지 않게, 촉구서 경과 작성용)
create or replace function public.keep_snapshot(p_id uuid default null, p_code text default null) returns jsonb
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
    'payments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.payments x where x.promise_id = v.id), '[]'::jsonb),
    'nudges', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.nudges n where n.promise_id = v.id), '[]'::jsonb)
  );
end $$;
revoke all on function public.keep_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.keep_snapshot(uuid, text) to service_role;
