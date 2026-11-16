// 매일 09:00 KST (pg_cron이 호출): 단계 점검 → 알림 큐 → 바로 발송, 보존 기한 지난 약속 파기
import { flush, purge, runDaily } from '../_shared/notify.ts';
import { adminClient, json, senders, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  const admin = adminClient();
  const { data: ok } = await admin.rpc('keep_check_cron_secret', { p_secret: req.headers.get('x-cron-secret') || '' });
  if (!ok) return json(req, { error: 'FORBIDDEN' }, 403);
  const db = supabaseDb(admin);
  const now = new Date();
  const daily = await runDaily(db, now, { appUrl: Deno.env.get('APP_BASE_URL') || undefined });
  const sent = await flush(db, senders(), { ids: daily.queued });
  const purged = await purge(db);
  console.log(JSON.stringify({ daily: daily.log, sent, purged }));
  return json(req, { checked: daily.checked, queued: daily.queued.length, sent, purged });
});
