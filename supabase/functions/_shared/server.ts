// Deno(Edge Function) 전용: supabase-js 기반 Db 구현, CORS, 인증, 오류 응답
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.49.4';
import { ActionError, type Ctx, type Db, type Snapshot } from './actions.ts';

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
  if (jwt && jwt.split('.').length === 3) {
    const { data } = await admin.auth.getUser(jwt);
    userId = data.user?.id ?? null;
  }
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  return { userId, ip: ip.slice(0, 64), ua: (req.headers.get('user-agent') || '').slice(0, 300), now: new Date() };
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
