-- 수정: 푸시 구독 저장 실패, 다시 로그인했을 때 알림 이메일·이름이 비는 문제
--  1) 푸시 구독은 서버 함수로 저장한다. 같은 기기(endpoint)에 다른 계정이 로그인하면 지금 계정으로 넘긴다.
--     (클라이언트 upsert는 UPDATE 권한·다른 계정 행의 RLS 때문에 실패했다)
--  2) 알림 이메일이 비어 있으면 로그인 이메일로 보낸다(이메일 알림을 켠 경우).
--  3) 프로필 행이 없으면 만든다(트리거 이전에 가입했거나 행이 사라진 경우 대비).

create function public.keep_push_subscribe(p_endpoint text, p_keys jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'LOGIN' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'BAD_ENDPOINT' using errcode = '22023'; end if;
  insert into public.push_subscriptions (endpoint, user_id, keys) values (p_endpoint, auth.uid(), p_keys)
  on conflict (endpoint) do update set user_id = excluded.user_id, keys = excluded.keys, created_at = now();
  update public.profiles set notify_push = true where id = auth.uid();
end $$;

create function public.keep_push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

create function public.keep_profile_ensure() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  if auth.uid() is null then raise exception 'LOGIN' using errcode = '42501'; end if;
  insert into public.profiles (id, display_name, notify_email)
  select u.id, left(split_part(coalesce(u.email, ''), '@', 1), 40), nullif(u.email, '') from auth.users u where u.id = auth.uid()
  on conflict (id) do nothing;
  -- 알림 이메일이 비었는데 이메일 알림이 켜져 있으면 로그인 이메일로 채운다
  update public.profiles p set notify_email = u.email
  from auth.users u where p.id = auth.uid() and u.id = p.id and p.notify_email is null and p.notify_email_on and u.email is not null;
  select * into v from public.profiles where id = auth.uid();
  return jsonb_build_object('id', v.id, 'display_name', v.display_name, 'notify_email', v.notify_email,
                            'notify_push', v.notify_push, 'notify_email_on', v.notify_email_on);
end $$;

revoke all on function public.keep_push_subscribe(text, jsonb), public.keep_push_unsubscribe(text), public.keep_profile_ensure() from public, anon;
grant execute on function public.keep_push_subscribe(text, jsonb), public.keep_push_unsubscribe(text), public.keep_profile_ensure() to authenticated;

-- 이메일 알림: 알림 이메일이 비면 로그인 이메일로
create or replace function public.keep_enqueue(p jsonb) returns bigint[]
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (p ->> 'user_id')::uuid;
  v_promise uuid := (p ->> 'promise_id')::uuid;
  v_prof public.profiles;
  v_email text;
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
  v_email := coalesce(v_prof.notify_email, (select u.email from auth.users u where u.id = v_user));
  if v_prof.notify_email_on and v_email is not null then
    insert into public.notifications (user_id, promise_id, channel, kind, title, body, url, send_after)
    values (v_user, v_promise, 'email', p ->> 'kind', p ->> 'title', coalesce(p ->> 'email_body', p ->> 'body'), p ->> 'url', coalesce((p ->> 'send_after')::timestamptz, now()))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end if;
  return v_ids;
end $$;

-- 발송 시점에도 같은 규칙으로 받는 주소를 정한다
create or replace function public.keep_claim_due(p_limit integer default 50, p_ids bigint[] default null) returns jsonb
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
    'email', coalesce((select pf.notify_email from public.profiles pf where pf.id = u.user_id), (select au.email from auth.users au where au.id = u.user_id)),
    'subs', case when u.channel = 'push' then (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', s.keys)), '[]'::jsonb) from public.push_subscriptions s where s.user_id = u.user_id) end
  ) order by u.id), '[]'::jsonb) into v from upd u;
  update public.notifications set status = 'queued' where status = 'sending' and attempts < 3 and created_at < now() - interval '30 minutes' and sent_at is null
    and id not in (select (e ->> 'id')::bigint from jsonb_array_elements(v) e);
  return v;
end $$;

revoke all on function public.keep_enqueue(jsonb), public.keep_claim_due(integer, bigint[]) from public, anon, authenticated;
grant execute on function public.keep_enqueue(jsonb), public.keep_claim_due(integer, bigint[]) to service_role;
