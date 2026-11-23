-- 송금 바로가기: 작성자가 받을 돈을 쉽게 받도록 공식 개인 송금 링크를 등록(선택)
--  · 토스 아이디(toss.me/아이디/금액) · 카카오페이 송금 링크(qr.kakaopay.com/…)
--  본인만 쓰고 고칠 수 있고, 상대방에게는 서버(pay_info, 당사자 확인)로만 알려 준다.
alter table public.profiles
  add column pay_toss_id text check (pay_toss_id is null or pay_toss_id ~ '^[A-Za-z0-9_.-]{2,30}$'),
  add column pay_kakao_url text check (pay_kakao_url is null or pay_kakao_url ~ '^https://qr\.kakaopay\.com/[A-Za-z0-9]{4,60}$');
grant select (pay_toss_id, pay_kakao_url), update (pay_toss_id, pay_kakao_url) on public.profiles to authenticated;

-- 약속의 작성자(A)가 등록한 송금 링크(당사자 확인은 Edge Function에서)
create function public.keep_pay_links(p_promise uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('toss', pf.pay_toss_id, 'kakao', pf.pay_kakao_url)
    from public.parties pa join public.profiles pf on pf.id = pa.user_id
    where pa.promise_id = p_promise and pa.role = 'A'), '{}'::jsonb);
$$;
revoke all on function public.keep_pay_links(uuid) from public, anon, authenticated;
grant execute on function public.keep_pay_links(uuid) to service_role;
