// Deno(Edge Function) 전용: supabase-js 기반 Db 구현, CORS, 인증, 오류 응답
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { ActionError, type Ctx, type Db, type Snapshot } from './actions.ts';
import webpush from 'npm:web-push@3.6.7';
import nodemailer from 'npm:nodemailer@6.9.16';
import type { Senders } from './notify.ts';
import { clientIp } from './clientIp.ts';

const env = (k: string, d = '') => Deno.env.get(k) ?? d;

export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

const ALLOWED = () => env('APP_ORIGINS', 'https://qkrwpgns-prog.github.io,http://localhost:5173,http://localhost:4173').split(',').map((s) => s.trim());

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED().includes(origin) ? origin : ALLOWED()[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Expose-Headers': 'x-keep-ai',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

export function errorResponse(req: Request, e: unknown) {
  if (e instanceof ActionError) return json(req, { error: e.code, message: e.message }, e.status);
  const msg = String((e as { message?: string })?.message || e);
  if (msg.includes('VERSION_CONFLICT')) return json(req, { error: 'VERSION_CONFLICT', message: '그사이 약속이 바뀌었어요. 새로고침해 주세요.' }, 409);
  if (msg.includes('BAD_STATUS') || msg.includes('NOT_PENDING')) return json(req, { error: 'BAD_STATUS', message: '지금 상태에서는 할 수 없는 동작이에요.' }, 409);
  console.error(e);
  return json(req, { error: 'SERVER', message: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }, 500);
}

export async function context(req: Request, admin: SupabaseClient): Promise<Ctx> {
  const auth = req.headers.get('authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (jwt && jwt.split('.').length === 3) {
    const { data } = await admin.auth.getUser(jwt);
    userId = data.user?.id ?? null;
    userEmail = data.user?.email ?? null;
  }
  const { ip, source } = clientIp(req.headers);
  return { userId, userEmail, ip: ip.slice(0, 64), ipSource: source, ua: (req.headers.get('user-agent') || '').slice(0, 300), now: new Date(), senders: senders(), appUrl: env('APP_BASE_URL') || undefined };
}

export function supabaseDb(admin: SupabaseClient): Db {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };
  return {
    snapshot: (q) => rpc<Snapshot | null>('keep_snapshot', { p_id: q.id ?? null, p_code: q.code ?? null }),
    create: (p) => rpc('keep_create', { p }),
    commit: (p) => rpc('keep_commit', { p }),
    rateCheck: (key, limit, windowSec) => rpc<boolean>('keep_rate_check', { p_key: key, p_limit: limit, p_window_sec: windowSec }),
    countInterestLoans: (userId, days) => rpc<number>('keep_count_interest_loans', { p_user: userId, p_days: days }),
    payLinks: (pid) => rpc('keep_pay_links', { p_promise: pid }),
    funnelMark: async (pid, step) => { await rpc('keep_funnel_mark', { p_promise: pid, p_step: step }); },
    abuseReport: async (promiseId, userId, reason) => { await rpc('keep_abuse_report', { p_promise: promiseId, p_user: userId, p_reason: reason }); },
    cronCandidates: (pid) => rpc('keep_cron_candidates', { p_promise: pid ?? null }),
    nudgeMark: (pid, dv, stage, status) => rpc<boolean>('keep_nudge_mark', { p_promise: pid, p_dv: dv, p_stage: stage, p_status: status }),
    installmentMark: (pid, dv, no, stage) => rpc<boolean>('keep_installment_mark', { p_promise: pid, p_dv: dv, p_no: no, p_stage: stage }),
    enqueue: async (p) => ((await rpc<number[] | null>('keep_enqueue', { p })) || []).map(Number),
    claimDue: (limit, ids) => rpc('keep_claim_due', { p_limit: limit, p_ids: ids ?? null }),
    finish: async (id, status, error) => { await rpc('keep_finish_notification', { p_id: id, p_status: status, p_error: error ?? null }); },
    dropSubscription: async (endpoint) => { await rpc('keep_drop_subscription', { p_endpoint: endpoint }); },
    systemEvent: async (pid, type, canon, simAt) => { await rpc('keep_system_event', { p_promise: pid, p_type: type, p_canon: canon, p_sim_at: simAt }); },
    purgeExpired: async () => (await rpc<string[] | null>('keep_purge_expired', {})) || [],
    aiTake: (userId, limit, global) => rpc<'ok' | 'user' | 'global'>('keep_ai_take_v2', { p_user: userId, p_limit: limit, p_global: global }),
    async putBinary(bucket, path, bytes, contentType) {
      const { error } = await admin.storage.from(bucket).upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: contentType }), { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },
    async signedUrl(bucket, path, seconds) {
      const { data } = await admin.storage.from(bucket).createSignedUrl(path, seconds);
      return data?.signedUrl ?? null;
    },
    async removeFiles(bucket, paths) { if (paths.length) await admin.storage.from(bucket).remove(paths); },
    async putFile(bucket, path, body, contentType) {
      const { error } = await admin.storage.from(bucket).upload(path, new Blob([body], { type: contentType }), { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },
    async getFile(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return await data.text();
    },
  };
}

// ---------------------------------------------------------------- 알림 발송 (Web Push + Gmail SMTP)

let vapidReady = false;
export function senders(): Senders {
  const pub = env('VAPID_PUBLIC_KEY'), priv = env('VAPID_PRIVATE_KEY');
  if (pub && priv && !vapidReady) { webpush.setVapidDetails(env('VAPID_SUBJECT', 'mailto:noreply@example.com'), pub, priv); vapidReady = true; }
  // Gmail SMTP: 465(SSL). Edge Function은 25·587 포트로 나가는 연결이 막혀 있어 465를 쓴다.
  const transport = env('SMTP_USER') && env('SMTP_PASS')
    ? nodemailer.createTransport({ host: env('SMTP_HOST', 'smtp.gmail.com'), port: Number(env('SMTP_PORT', '465')), secure: true, auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') } })
    : null;
  return {
    async push(sub, payload) {
      if (!vapidReady) return 'VAPID 키 없음';
      try {
        await webpush.sendNotification(sub as webpush.PushSubscription, payload, { TTL: 60 * 60 * 24, urgency: 'normal' });
        return 'ok';
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        return code === 404 || code === 410 ? 'gone' : `push ${code || ''} ${(e as Error).message}`.slice(0, 200);
      }
    },
    async email(to, subject, text, html) {
      if (!transport) throw new Error('SMTP 설정 없음');
      await transport.sendMail({ from: `"키프" <${env('SMTP_FROM', env('SMTP_USER'))}>`, to, subject, text, html });
    },
  };
}
