-- 매일 09:00 KST(=00:00 UTC) 단계 점검, 15분마다 알림 큐 발송.
-- pg_cron·pg_net이 있는 환경(Supabase)에서만 예약한다. 로컬 테스트용 PostgreSQL에는 없어서 건너뛴다.
-- Edge Function은 x-cron-secret 헤더를 private.settings의 값과 대조한다(keep_check_cron_secret).

do $outer$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron/pg_net 없음: 예약 작업을 건너뜁니다';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute 'create extension if not exists pg_net with schema extensions';

  execute $f$
    create or replace function private.call_function(p_name text) returns bigint
    language sql security definer set search_path = '' as $b$
      select net.http_post(
        url := (select value from private.settings where key = 'project_url') || '/functions/v1/' || p_name,
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-cron-secret', (select value from private.settings where key = 'cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 55000
      );
    $b$
  $f$;

  perform cron.schedule('keep-daily', '0 0 * * *', 'select private.call_function(''cron-daily'')');
  perform cron.schedule('keep-flush', '*/15 * * * *', 'select private.call_function(''notify-flush'')');
end
$outer$;
