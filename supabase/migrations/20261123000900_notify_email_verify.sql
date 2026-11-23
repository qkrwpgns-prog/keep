-- 알림 이메일 변경은 인증 코드로 확인한 뒤에만
-- 이전에는 로그인 사용자가 알림 이메일을 아무 주소로나 바꿀 수 있어, 남의 주소로 약속 내용 메일을 보내는 통로가 될 수 있었다.

alter table public.profiles
  add column notify_email_pending text check (notify_email_pending is null or notify_email_pending ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column notify_email_code_hash text,
  add column notify_email_code_expires timestamptz,
  add column notify_email_code_attempts integer not null default 0;

-- 클라이언트가 알림 이메일을 직접 바꾸지 못하게
revoke update (notify_email) on public.profiles from authenticated;

-- 대기 중인 주소와 코드 해시 저장(서버 전용). 같은 주소를 로그인 이메일로 되돌릴 때는 서버가 바로 확정한다
create function public.keep_email_set_pending(p_user uuid, p_email text, p_code_hash text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles
     set notify_email_pending = lower(p_email), notify_email_code_hash = p_code_hash,
         notify_email_code_expires = now() + interval '10 minutes', notify_email_code_attempts = 0
   where id = p_user;
$$;

create function public.keep_email_set_direct(p_user uuid, p_email text) returns void
language sql security definer set search_path = '' as $$
  update public.profiles
     set notify_email = lower(p_email), notify_email_pending = null, notify_email_code_hash = null,
         notify_email_code_expires = null, notify_email_code_attempts = 0
   where id = p_user;
$$;

-- 결과: ok | none | expired | locked | mismatch
create function public.keep_email_verify(p_user uuid, p_code_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.profiles;
begin
  select * into v from public.profiles where id = p_user for update;
  if not found or v.notify_email_pending is null or v.notify_email_code_hash is null then return 'none'; end if;
  if v.notify_email_code_attempts >= 5 then return 'locked'; end if;
  if v.notify_email_code_expires < now() then return 'expired'; end if;
  if v.notify_email_code_hash <> p_code_hash then
    update public.profiles set notify_email_code_attempts = notify_email_code_attempts + 1 where id = p_user;
    return 'mismatch';
  end if;
  update public.profiles
     set notify_email = v.notify_email_pending, notify_email_pending = null, notify_email_code_hash = null,
         notify_email_code_expires = null, notify_email_code_attempts = 0, notify_email_on = true
   where id = p_user;
  return 'ok';
end $$;

revoke all on function public.keep_email_set_pending(uuid, text, text), public.keep_email_set_direct(uuid, text), public.keep_email_verify(uuid, text) from public, anon, authenticated;
grant execute on function public.keep_email_set_pending(uuid, text, text), public.keep_email_set_direct(uuid, text), public.keep_email_verify(uuid, text) to service_role;
