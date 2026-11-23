-- 수정: 알림 중복 발송
-- 30분 넘게 '발송 중'인 알림을 되돌리는 기준이 '알림을 만든 시각'이라, 밤사이 미뤄 둔 알림을
-- 아침에 두 발송 함수가 동시에 처리하면 다른 쪽이 보내는 중인 알림을 되돌려 두 번 보낼 수 있었다.
-- → '발송을 시작한 시각(claimed_at)'을 따로 두고 그 기준으로 판단한다.
alter table public.notifications add column claimed_at timestamptz;

create or replace function public.keep_claim_due(p_limit integer default 50, p_ids bigint[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  -- 함수가 중간에 죽어 30분 넘게 '발송 중'으로 남은 것만 다시 대기열로
  update public.notifications set status = 'queued'
  where status = 'sending' and attempts < 3 and sent_at is null and claimed_at < now() - interval '30 minutes';

  with due as (
    select n.id from public.notifications n
    where n.status = 'queued' and n.send_after <= now() and (p_ids is null or n.id = any (p_ids))
    order by n.id for update skip locked limit p_limit
  ), upd as (
    update public.notifications n set status = 'sending', attempts = n.attempts + 1, claimed_at = now()
    from due where n.id = due.id returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'user_id', u.user_id, 'promise_id', u.promise_id, 'channel', u.channel, 'kind', u.kind,
    'title', u.title, 'body', u.body, 'url', u.url,
    'email', coalesce((select pf.notify_email from public.profiles pf where pf.id = u.user_id), (select au.email from auth.users au where au.id = u.user_id)),
    'subs', case when u.channel = 'push' then (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys)), '[]'::jsonb) from public.push_subscriptions s where s.user_id = u.user_id) end
  ) order by u.id), '[]'::jsonb) into v from upd u;
  return v;
end $$;
revoke all on function public.keep_claim_due(integer, bigint[]) from public, anon, authenticated;
grant execute on function public.keep_claim_due(integer, bigint[]) to service_role;
