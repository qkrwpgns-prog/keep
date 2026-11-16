-- 비공개 저장소 버킷 + 탈퇴 처리
-- 버킷에는 클라이언트용 정책을 두지 않는다 → 서명·캡처 파일은 Edge Function(service_role)만 읽고 쓴다.

insert into storage.buckets (id, name, public)
values ('signatures', 'signatures', false), ('evidence', 'evidence', false)
on conflict (id) do nothing;

-- 탈퇴 (결정된 정책 (가))
--  · 상대 서명이 끝나지 않은 약속(초안·서명 대기·수정 요청·취소·거절): 약속째 삭제 → 삭제된 약속 id 목록과 상대 user_id를 돌려줘 알림·파일 삭제에 쓴다
--  · 양측 서명 완료 약속: 상대의 증거로 보존. 탈퇴자 user_id 끊기, IP 앞 두 자리만, UA는 OS·브라우저 수준으로 축약
--    보존 기한: 완료된 약속은 완료 후 1년, 미완료는 기한 후 10년 (retain_until, 만료 시 파기는 2단계 cron)
create function public.keep_delete_account(p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_deleted jsonb;
  v_kept integer;
begin
  -- 1) 삭제 대상
  with mine as (
    select pr.id, pr.status from public.promises pr
    join public.parties me on me.promise_id = pr.id and me.user_id = p_user
  ),
  doomed as (
    select m.id from mine m
    where m.status in ('draft', 'pending_b', 'revise', 'cancelled', 'declined')
       or exists (select 1 from public.parties x where x.promise_id = m.id and x.signed_at is null)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'other_user', (select x.user_id from public.parties x where x.promise_id = d.id and x.user_id is distinct from p_user and x.user_id is not null limit 1),
           'paths', (select coalesce(jsonb_agg(x.signature_path), '[]'::jsonb) from public.parties x where x.promise_id = d.id and x.signature_path is not null)
         )), '[]'::jsonb)
    into v_deleted
  from doomed d;

  perform set_config('keep.allow_event_purge', 'on', true);
  delete from public.promises where id in (select (e ->> 'id')::uuid from jsonb_array_elements(v_deleted) e);
  perform set_config('keep.allow_event_purge', 'off', true);

  -- 2) 보존 대상: 개인 식별정보 최소화
  update public.promises pr set
    retain_until = case when pr.status = 'done' then (coalesce(pr.done_at, now()) + interval '1 year')::date
                        else (coalesce(pr.deadline, current_date) + interval '10 years')::date end,
    updated_at = now()
  where pr.id in (select promise_id from public.parties where user_id = p_user);

  update public.parties set
    user_id = null,
    signer_ip = case when signer_ip ~ '^\d+\.\d+\.' then regexp_replace(signer_ip, '^(\d+\.\d+)\..*$', '\1.*.*')
                     when signer_ip like '%:%' then split_part(signer_ip, ':', 1) || ':*' else null end,
    signer_ua = case when signer_ua ~* 'iphone|ipad' then 'iOS'
                     when signer_ua ~* 'android' then 'Android'
                     when signer_ua ~* 'mac os' then 'macOS'
                     when signer_ua ~* 'windows' then 'Windows'
                     else '기타' end
  where user_id = p_user;
  get diagnostics v_kept = row_count;

  delete from public.push_subscriptions where user_id = p_user;
  update public.profiles set display_name = null, notify_email = null, deleted_at = now() where id = p_user;

  return jsonb_build_object('deleted', v_deleted, 'kept', v_kept);
end $$;

revoke all on function public.keep_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.keep_delete_account(uuid) to service_role;
