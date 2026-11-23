-- 신고 처리(운영자 화면)
--  · abuse_reports에 처리 상태·메모·처리 시각
--  · promises.nudge_blocked: 이 약속의 재촉·촉구서·자동 알림을 멈춤
--  · profiles.nudge_suspended_until: 이 사용자가 만든 약속의 재촉을 기간 동안 멈춤
--  운영자는 Edge Function 환경 변수 ADMIN_EMAILS(로그인 이메일 목록)로 정한다. DB 함수는 service_role 전용.

alter table public.abuse_reports
  add column status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  add column admin_note text check (admin_note is null or char_length(admin_note) <= 500),
  add column handled_at timestamptz,
  add column handled_by uuid references auth.users (id) on delete set null;

alter table public.promises add column nudge_blocked boolean not null default false;
alter table public.profiles add column nudge_suspended_until timestamptz;

-- 재촉 차단 여부(약속 차단 또는 작성자 정지)
create function private.nudge_blocked(p_promise uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.promises where id = p_promise and nudge_blocked)
      or exists (select 1 from public.parties pa join public.profiles pf on pf.id = pa.user_id
                 where pa.promise_id = p_promise and pa.role = 'A' and pf.nudge_suspended_until > now());
$$;

-- 차단된 약속에는 재촉 기록(직접 보냄·자동 알림)이 새로 생기지 않는다
create function private.nudges_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.nudge_blocked(new.promise_id) then
    raise exception 'NUDGE_BLOCKED' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger nudges_guard before insert or update of status, message on public.nudges
  for each row execute function private.nudges_guard();

-- 자동 점검 대상에서 차단된 약속 제외
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
    and (p_promise is null or pr.id = p_promise)
    and not private.nudge_blocked(pr.id);
$$;

-- 신고 목록(상태별, 최신순). 약속·당사자·보낸 재촉 문구·작성자의 누적 신고 수를 함께
create function public.keep_admin_reports(p_status text default 'open') returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'status', r.status, 'admin_note', r.admin_note,
      'created_at', r.created_at, 'handled_at', r.handled_at,
      'reporter_role', (select pa.role from public.parties pa where pa.promise_id = r.promise_id and pa.user_id = r.reporter limit 1),
      'promise', jsonb_build_object('id', pr.id, 'share_code', pr.share_code, 'template', pr.template, 'title', pr.title,
        'status', pr.status, 'deadline', pr.deadline, 'amount', pr.amount, 'is_demo', pr.is_demo, 'nudge_blocked', pr.nudge_blocked),
      'parties', (select jsonb_agg(jsonb_build_object('role', pa.role, 'name', pa.display_name, 'user_id', pa.user_id) order by pa.role)
                  from public.parties pa where pa.promise_id = pr.id),
      'nudges', coalesce((select jsonb_agg(jsonb_build_object('stage', n.stage, 'status', n.status, 'message', n.message, 'tone', n.tone, 'sent_at', n.sent_at) order by n.created_at)
                  from public.nudges n where n.promise_id = pr.id), '[]'::jsonb),
      'author', (select jsonb_build_object('user_id', pf.id, 'suspended_until', pf.nudge_suspended_until,
                   'reports', (select count(*) from public.abuse_reports r2 join public.parties a2 on a2.promise_id = r2.promise_id and a2.role = 'A' where a2.user_id = pf.id))
                 from public.parties a join public.profiles pf on pf.id = a.user_id where a.promise_id = pr.id and a.role = 'A')
    ) as x
    from public.abuse_reports r join public.promises pr on pr.id = r.promise_id
    where p_status = 'all' or r.status = p_status
    limit 200
  ) s;
$$;

-- 신고 처리: 상태·메모 기록, 필요하면 약속 재촉 차단·작성자 재촉 정지(일수). 결과로 알릴 대상을 돌려준다
create function public.keep_admin_handle(p_report uuid, p_admin uuid, p_status text, p_note text, p_block boolean, p_suspend_days integer)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_r public.abuse_reports;
  v_author uuid;
  v_until timestamptz;
begin
  if p_status not in ('open', 'dismissed', 'actioned') then raise exception 'BAD_STATUS' using errcode = '22023'; end if;
  if p_suspend_days is not null and (p_suspend_days < 0 or p_suspend_days > 365) then raise exception 'BAD_DAYS' using errcode = '22023'; end if;
  select * into v_r from public.abuse_reports where id = p_report for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select user_id into v_author from public.parties where promise_id = v_r.promise_id and role = 'A';

  update public.abuse_reports set status = p_status, admin_note = nullif(left(coalesce(p_note, ''), 500), ''),
    handled_at = case when p_status = 'open' then null else now() end,
    handled_by = case when p_status = 'open' then null else p_admin end
  where id = p_report;

  if p_block is not null then
    update public.promises set nudge_blocked = p_block where id = v_r.promise_id and nudge_blocked is distinct from p_block;
    if found then
      perform public.keep_system_event(v_r.promise_id, case when p_block then 'admin_block' else 'admin_unblock' end,
        jsonb_build_object('report', p_report)::text, null);
    end if;
  end if;
  if p_suspend_days is not null and v_author is not null then
    v_until := case when p_suspend_days = 0 then null else now() + make_interval(days => p_suspend_days) end;
    update public.profiles set nudge_suspended_until = v_until where id = v_author;
  end if;

  return jsonb_build_object('promise_id', v_r.promise_id, 'reporter', v_r.reporter, 'author', v_author,
    'blocked', (select nudge_blocked from public.promises where id = v_r.promise_id),
    'suspended_until', (select nudge_suspended_until from public.profiles where id = v_author));
end $$;

revoke all on function private.nudge_blocked(uuid), private.nudges_guard() from public, anon, authenticated;
revoke all on function public.keep_admin_reports(text), public.keep_admin_handle(uuid, uuid, text, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.keep_admin_reports(text), public.keep_admin_handle(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function private.nudge_blocked(uuid) to service_role;
