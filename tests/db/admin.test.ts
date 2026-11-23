// 신고 처리(운영자): 권한, 재촉 멈춤·작성자 정지, 결과 알림
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { handleAdmin, type AdminDb } from '../../supabase/functions/_shared/adminActions.ts';
import { runDaily } from '../../supabase/functions/_shared/notify.ts';
import { addDays, kstYmd } from '../../supabase/functions/_shared/domain/dates.ts';
import { asService, asUser, ctxFor, fakeSenders, newUser, pool, SIG, testDb } from './harness.ts';

const kst10 = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 1));
const BASE = kst10(new Date(Date.now() - 864e5 + 9 * 3600e3));
const today = kstYmd(BASE);
const fake = fakeSenders();
const ADMINS = ['admin@keep.test'];
let A: string, B: string, OP: string;

const ctx = (u: string | null, email?: string) => ({ ...ctxFor(u, BASE), userEmail: email ?? null, senders: fake.senders, appUrl: 'https://example.test/keep/' });
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctx(u), body);
const adminDb: AdminDb = {
  ...testDb,
  funnelStats: (d) => asService('select public.keep_funnel_stats($1) as v', [d]),
  adminReports: (st) => asService('select public.keep_admin_reports($1) as v', [st]),
  adminHandle: (id, adm, st, note, block, days) => asService('select public.keep_admin_handle($1, $2, $3, $4, $5, $6) as v', [id, adm, st, note, block, days]),
};
const op = (body: Record<string, unknown>, email = 'Admin@Keep.test') => handleAdmin(adminDb, ctx(OP, email), ADMINS, body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const expectErr = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === code);

async function activePromise(offset: number, title: string) {
  const r = await act(A, { action: 'create', tpl: 'loan', fields: { title, aName: '박제훈', bName: '김민수', amount: '300000', deadline: addDays(today, offset), method: '계좌이체' }, signature: SIG, agree: true });
  await act(B, { action: 'claim', code: r.code, consent: true });
  await act(B, { action: 'sign', id: r.id, version: await version(r.id as string), signature: SIG, agree: true });
  return r as { id: string; code: string };
}
const reportOf = async (pid: string) => (await pool.query('select id from abuse_reports where promise_id = $1', [pid])).rows[0].id as string;

beforeAll(async () => {
  A = await newUser('작성자'); B = await newUser('상대방'); OP = await newUser('운영자');
  await pool.query(`update profiles set notify_email = 'a@mail.test' where id = $1`, [A]);
  await pool.query(`update profiles set notify_email = 'b@mail.test' where id = $1`, [B]);
});
afterAll(async () => { await pool.end(); });

describe('운영자 권한', () => {
  it('ADMIN_EMAILS에 없는 계정은 목록을 볼 수 없다(대소문자 무시)', async () => {
    expect(await op({ action: 'me' }, 'someone@else.test')).toEqual({ admin: false });
    expect(await op({ action: 'me' })).toEqual({ admin: true });
    await expectErr(op({ action: 'reports' }, 'someone@else.test'), 'NOT_ADMIN');
  });
  it('운영자는 B 진입 퍼널 집계를 본다(기간은 1~365일로 제한)', async () => {
    const r = await op({ action: 'funnel', days: 9999 }) as { funnel: { days: number; created: number } };
    expect(r.funnel.days).toBe(365);
    expect(typeof r.funnel.created).toBe('number');
    await expectErr(op({ action: 'funnel' }, 'someone@else.test'), 'NOT_ADMIN');
  });
  it('일반 사용자는 신고 테이블·처리 함수에 직접 접근할 수 없다', async () => {
    await expect(asUser(B, 'select * from abuse_reports')).rejects.toThrow(/permission denied/);
    await expect(asUser(B, `select public.keep_admin_reports('all')`)).rejects.toThrow(/permission denied/);
  });
});

describe('신고 처리', () => {
  it('목록에 사유·재촉 문구·작성자 누적 신고 수가 나온다', async () => {
    const p = await activePromise(-3, '신고될 약속');
    await act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '민수야 약속한 30만원 언제 줄 수 있어?', tone: 3, rel: '친구' });
    await act(B, { action: 'abuse_report', id: p.id, reason: '하루에도 여러 번 연락이 와요' });
    const { reports } = await op({ action: 'reports', status: 'open' }) as { reports: { id: string; reason: string; reporter_role: string; nudges: { message: string }[]; author: { reports: number } }[] };
    const r = reports.find((x) => x.reason.includes('여러 번'))!;
    expect(r.reporter_role).toBe('B');
    expect(r.nudges[0].message).toContain('30만원');
    expect(r.author.reports).toBeGreaterThanOrEqual(1);
  });

  it('조치(재촉 멈춤) → A는 재촉을 못 보내고, 크론도 건너뛰고, 양쪽에 알림·기록', async () => {
    const p = await activePromise(-7, '멈출 약속');
    await act(B, { action: 'abuse_report', id: p.id, reason: '위협적으로 느껴져요' });
    await expectErr(op({ action: 'handle', id: await reportOf(p.id), status: 'actioned' }), 'ACTION');
    fake.sent.length = 0;
    const out = await op({ action: 'handle', id: await reportOf(p.id), status: 'actioned', note: '반복 재촉', block: true });
    expect(out).toMatchObject({ ok: true, blocked: true });
    expect(fake.sent.some((x) => x.to === 'b@mail.test' && /신고를 확인했어요/.test(x.title))).toBe(true);
    expect(fake.sent.some((x) => x.to === 'a@mail.test' && /제한됐어요/.test(x.title))).toBe(true);
    await expectErr(act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 4, text: '한 번 더 확인해 줘', tone: 2, rel: '친구' }), 'NUDGE_BLOCKED');
    expect((await runDaily(testDb, BASE)).log.some((l) => l.startsWith(p.code))).toBe(false);
    const ev = await asUser<{ type: string }>(A, `select type from events where promise_id = $1 and type like 'admin_%'`, [p.id]);
    expect(ev).toEqual([{ type: 'admin_block' }]);
    const [row] = await asUser<{ nudge_blocked: boolean }>(A, 'select nudge_blocked from promises where id = $1', [p.id]);
    expect(row.nudge_blocked).toBe(true);
  });

  it('작성자 재촉 정지(일수) → 다른 약속도 재촉 불가, 0일로 해제', async () => {
    const p1 = await activePromise(-3, '정지 대상');
    const p2 = await activePromise(-3, '다른 약속');
    await act(B, { action: 'abuse_report', id: p1.id, reason: '계속 같은 말을 보내요' });
    await op({ action: 'handle', id: await reportOf(p1.id), status: 'actioned', suspendDays: 30 });
    await expectErr(act(A, { action: 'nudge_send', id: p2.id, version: await version(p2.id), stage: 3, text: '약속 기억나?', tone: 2, rel: '친구' }), 'NUDGE_BLOCKED');
    await op({ action: 'handle', id: await reportOf(p1.id), status: 'dismissed', suspendDays: 0 });
    await act(A, { action: 'nudge_send', id: p2.id, version: await version(p2.id), stage: 3, text: '약속 기억나?', tone: 2, rel: '친구' });
  });

  it('기각하면 신고한 사람에게만 결과 알림, 재촉은 그대로 가능', async () => {
    const p = await activePromise(-3, '기각될 약속');
    await act(B, { action: 'abuse_report', id: p.id, reason: '그냥 싫어요' });
    fake.sent.length = 0;
    await op({ action: 'handle', id: await reportOf(p.id), status: 'dismissed' });
    expect(fake.sent.filter((x) => x.to === 'b@mail.test')).toHaveLength(1);
    expect(fake.sent.filter((x) => x.to === 'a@mail.test')).toHaveLength(0);
    const { reports } = await op({ action: 'reports', status: 'dismissed' }) as { reports: { reason: string; handled_at: string }[] };
    expect(reports.find((x) => x.reason === '그냥 싫어요')?.handled_at).toBeTruthy();
  });
});
