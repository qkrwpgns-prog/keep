// 테스트용 Db 구현: Edge Function과 같은 keep_* 함수를 service_role 권한으로 호출한다.
import pg from 'pg';
import type { Db, Ctx } from '../../supabase/functions/_shared/actions.ts';
import { ADMIN_URL, DB_NAME } from './setup.ts';

// PostgREST(JSON)와 같은 모양으로: date는 문자열, bigint·numeric은 숫자, timestamptz는 ISO 문자열
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString());

export const pool = new pg.Pool({ connectionString: ADMIN_URL.replace(/\/[^/]*$/, '/' + DB_NAME), max: 4 });
export const files = new Map<string, string>();

async function asService<T>(sql: string, params: unknown[]): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role service_role');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows[0]?.v as T;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export const testDb: Db = {
  snapshot: (q) => asService('select public.keep_snapshot($1, $2) as v', [q.id ?? null, q.code ?? null]),
  create: (p) => asService('select public.keep_create($1) as v', [p]),
  commit: (p) => asService('select public.keep_commit($1) as v', [p]),
  rateCheck: (k, l, w) => asService('select public.keep_rate_check($1, $2, $3) as v', [k, l, w]),
  countInterestLoans: (u, d) => asService('select public.keep_count_interest_loans($1, $2) as v', [u, d]),
  abuseReport: async (pid, uid, reason) => { await asService('select public.keep_abuse_report($1, $2, $3) as v', [pid, uid, reason]); },
  cronCandidates: (pid) => asService('select public.keep_cron_candidates($1) as v', [pid ?? null]),
  nudgeMark: (pid, dv, stage, st) => asService('select public.keep_nudge_mark($1, $2, $3, $4) as v', [pid, dv, stage, st]),
  enqueue: async (p) => ((await asService<string[]>('select public.keep_enqueue($1) as v', [p])) || []).map(Number),
  claimDue: (limit, ids) => asService('select public.keep_claim_due($1, $2) as v', [limit, ids ?? null]),
  finish: async (id, st, err) => { await asService('select public.keep_finish_notification($1, $2, $3) as v', [id, st, err ?? null]); },
  dropSubscription: async (ep) => { await asService('select public.keep_drop_subscription($1) as v', [ep]); },
  systemEvent: async (pid, type, canon, simAt) => { await asService('select public.keep_system_event($1, $2, $3, $4) as v', [pid, type, canon, simAt]); },
  purgeExpired: async () => (await asService<string[]>('select public.keep_purge_expired() as v', [])) || [],
  aiTake: (u, limit) => asService('select public.keep_ai_take($1, $2) as v', [u, limit]),
  async putBinary(bucket, path, bytes) { files.set(bucket + '/' + path, `<${bytes.length} bytes>`); },
  async signedUrl(bucket, path) { return files.has(bucket + '/' + path) ? `https://storage.test/${bucket}/${path}?token=t` : null; },
  removeFiles: async (bucket, paths) => { for (const p of paths) files.delete(bucket + '/' + p); },
  async putFile(bucket, path, body) { if (files.has(bucket + '/' + path)) throw new Error('exists'); files.set(bucket + '/' + path, body); },
  async getFile(bucket, path) { return files.get(bucket + '/' + path) ?? null; },
};

/** 가짜 발송기: 보낸 것을 기록만 한다. gone에 든 endpoint는 만료된 구독으로 응답 */
export function fakeSenders() {
  const sent: { channel: 'push' | 'email'; to: string; title: string; body: string }[] = [];
  const gone = new Set<string>();
  return {
    sent, gone,
    senders: {
      async push(sub: { endpoint: string }, payload: string) {
        if (gone.has(sub.endpoint)) return 'gone';
        const p = JSON.parse(payload);
        sent.push({ channel: 'push' as const, to: sub.endpoint, title: p.title, body: p.body });
        return 'ok';
      },
      async email(to: string, subject: string, text: string) { sent.push({ channel: 'email' as const, to, title: subject, body: text }); },
    },
  };
}

export async function newUser(name: string): Promise<string> {
  const r = await pool.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [`${name}-${Math.random().toString(36).slice(2, 7)}@example.com`, { name }]);
  return r.rows[0].id;
}

export const ctxFor = (userId: string | null, now = new Date()): Ctx => ({ userId, ip: '203.0.113.7', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) KAKAOTALK', now });

/** RLS 적용 상태로 쿼리: role=authenticated(또는 anon) + JWT sub */
export async function asUser<T = Record<string, unknown>>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' })]);
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

// 간단한 서명 획(사각형 + 대각선)
export const SIG = [[10, 10, 60, 10, 60, 40, 10, 40], [12, 12, 58, 38]];
