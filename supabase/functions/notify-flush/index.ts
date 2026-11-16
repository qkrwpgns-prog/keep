// 15분마다 (pg_cron이 호출): 밤사이 미뤄 둔 알림 등 보낼 차례가 된 알림 발송
import { flush } from '../_shared/notify.ts';
import { adminClient, json, senders, supabaseDb } from '../_shared/server.ts';

Deno.serve(async (req) => {
  const admin = adminClient();
  const { data: ok } = await admin.rpc('keep_check_cron_secret', { p_secret: req.headers.get('x-cron-secret') || '' });
  if (!ok) return json(req, { error: 'FORBIDDEN' }, 403);
  return json(req, await flush(supabaseDb(admin), senders(), { limit: 100 }));
});
