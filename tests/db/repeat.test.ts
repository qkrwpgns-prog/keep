// 반복 약속: 규칙 → 회차·금액·기한, 증서 해시, 회차별 상환과 완료
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';

const now = new Date();
const today = kstToday(now);
let A: string, B: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctxFor(u, now), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const expectErr = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === code);
const fields = { title: '월세 분담', aName: '박제훈', bName: '김민수', method: '계좌이체' };
const rule = { every: 'month', count: 3, per: 50000, first: addDays(today, 5) };

beforeAll(async () => { A = await newUser('작성자'); B = await newUser('상대방'); });
afterAll(async () => { await pool.end(); });

describe('반복 약속', () => {
  it('규칙으로 회차를 만들고 금액·기한을 계산, B가 서명하면 확정', async () => {
    const r = await act(A, { action: 'create', tpl: 'split', fields, repeat: rule, signature: SIG, agree: true }) as { id: string; code: string };
    const [row] = await asUser<{ amount: number; deadline: string; installments: { amount: number; date: string }[] }>(A, 'select amount, deadline, installments from promises where id = $1', [r.id]);
    expect(row.amount).toBe(150000);
    expect(row.installments.map((x) => x.amount)).toEqual([50000, 50000, 50000]);
    expect(row.deadline).toBe(row.installments[2].date);
    const [ev] = await asUser<{ payload: { repeat: unknown } }>(A, `select payload from events where promise_id = $1 and type = 'created'`, [r.id]);
    expect(ev.payload.repeat).toEqual(rule);
    await act(B, { action: 'claim', code: r.code, consent: true });
    await act(B, { action: 'sign', id: r.id, version: await version(r.id), signature: SIG, agree: true });
    // 회차별로 신고·확인 → 마지막 회차를 확인하면 완료
    for (let i = 0; i < 3; i++) {
      await act(B, { action: 'report', id: r.id, version: await version(r.id), amount: 50000, paidOn: today });
      await act(A, { action: 'confirm', id: r.id, version: await version(r.id) });
    }
    const [done] = await asUser<{ status: string }>(A, 'select status from promises where id = $1', [r.id]);
    expect(done.status).toBe('done');
  });

  it('잘못된 규칙·돈 약속이 아닌 경우는 거부', async () => {
    await expectErr(act(A, { action: 'create', tpl: 'split', fields, repeat: { ...rule, count: 30 }, signature: SIG, agree: true }), 'REPEAT');
    await expectErr(act(A, { action: 'create', tpl: 'split', fields, repeat: { ...rule, first: addDays(today, -1) }, signature: SIG, agree: true }), 'REPEAT');
    await expectErr(act(A, { action: 'create', tpl: 'lend', fields: { ...fields, item: '스위치' }, repeat: rule, signature: SIG, agree: true }), 'REPEAT');
  });

  it('수정해서 다시 서명할 때 규칙을 바꾸거나 끌 수 있다', async () => {
    const r = await act(A, { action: 'create', tpl: 'loan', fields, repeat: rule, signature: SIG, agree: true }) as { id: string };
    await act(A, { action: 'update', id: r.id, version: await version(r.id), tpl: 'loan', fields, repeat: { ...rule, every: 'week', count: 4 }, signature: SIG, agree: true });
    let [row] = await asUser<{ amount: number; installments: unknown[] }>(A, 'select amount, installments from promises where id = $1', [r.id]);
    expect([row.amount, row.installments.length]).toEqual([200000, 4]);
    await act(A, { action: 'update', id: r.id, version: await version(r.id), tpl: 'loan', fields: { ...fields, amount: '70000', deadline: addDays(today, 30) }, repeat: null, signature: SIG, agree: true });
    [row] = await asUser<{ amount: number; installments: unknown[] }>(A, 'select amount, installments from promises where id = $1', [r.id]);
    expect([row.amount, row.installments.length]).toEqual([70000, 0]);
  });
});
