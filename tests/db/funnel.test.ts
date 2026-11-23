// B 진입 퍼널: 단계 기록과 집계
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, publicPreview, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { addDays, kstYmd } from '../../supabase/functions/_shared/domain/dates.ts';
import { asService, asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';

const now = new Date();
const today = kstYmd(now);
let A: string, B: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctxFor(u, now), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const steps = async (id: string) => (await pool.query('select step, count from funnel_steps where promise_id = $1 order by step', [id])).rows;
const stats = () => asService<Record<string, number>>('select public.keep_funnel_stats(30) as v', []);
const make = async (title: string) => act(A, { action: 'create', tpl: 'loan', fields: { title, aName: '박제훈', bName: '김민수', amount: '50000', deadline: addDays(today, 10), method: '계좌이체' }, signature: SIG, agree: true }) as Promise<{ id: string; code: string }>;

beforeAll(async () => { A = await newUser('작성자'); B = await newUser('상대방'); });
afterAll(async () => { await pool.end(); });

describe('B 진입 퍼널', () => {
  it('로그인 전 미리보기는 view, 작성자 본인의 미리보기는 세지 않는다', async () => {
    const p = await make('퍼널 1');
    await publicPreview(testDb, ctxFor(null, now), p.code);
    await publicPreview(testDb, ctxFor(null, now), p.code);
    await publicPreview(testDb, ctxFor(A, now), p.code);
    expect(await steps(p.id)).toEqual([{ step: 'view', count: 2 }]);
  });

  it('otp·login 단계 기록, 이상한 단계는 거부, 서명 끝난 약속은 기록하지 않음', async () => {
    const p = await make('퍼널 2');
    expect(await publicPreview(testDb, ctxFor(null, now), p.code, 'otp')).toEqual({ ok: true });
    await publicPreview(testDb, ctxFor(B, now), p.code, 'login');
    await expect(publicPreview(testDb, ctxFor(null, now), p.code, 'hack')).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === 'STEP');
    await act(B, { action: 'claim', code: p.code, consent: true });
    await act(B, { action: 'sign', id: p.id, version: await version(p.id), signature: SIG, agree: true });
    await publicPreview(testDb, ctxFor(null, now), p.code);
    expect((await steps(p.id)).map((r) => r.step)).toEqual(['login', 'otp']);
  });

  it('집계: 뒤 단계에 도달하면 앞 단계도 지난 것으로 센다, 시연은 제외', async () => {
    const before = await stats();
    const p1 = await make('퍼널 3'); // 열기만
    await publicPreview(testDb, ctxFor(null, now), p1.code);
    const p2 = await make('퍼널 4'); // 이미 로그인한 B가 바로 연결·서명(otp·login 기록 없음)
    await act(B, { action: 'claim', code: p2.code, consent: true });
    await act(B, { action: 'sign', id: p2.id, version: await version(p2.id), signature: SIG, agree: true });
    const demo = await make('시연 퍼널');
    await pool.query('update promises set is_demo = true where id = $1', [demo.id]);
    const after = await stats();
    const d = (k: string) => after[k] - before[k];
    expect([d('created'), d('viewed'), d('otp'), d('login'), d('joined'), d('signed')]).toEqual([2, 2, 1, 1, 1, 1]);
    expect(after.median_hours_to_sign).not.toBeNull();
  });

  it('일반 사용자는 퍼널 기록을 볼 수 없다', async () => {
    await expect(asUser(B, 'select * from funnel_steps')).rejects.toThrow(/permission denied/);
  });
});
