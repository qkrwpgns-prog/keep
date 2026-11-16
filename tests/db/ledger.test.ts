// 5단계: 상환 장부(부분 상환), 여러 명 정산, 분할 회차 알림
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError, handleAction } from '../../supabase/functions/_shared/actions.ts';
import { runDaily } from '../../supabase/functions/_shared/notify.ts';
import { addDays, kstYmd } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, fakeSenders, newUser, pool, SIG, testDb } from './harness.ts';

const BASE = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 1) - 864e5); // 어제 10시 KST
const today = kstYmd(BASE);
const fake = fakeSenders();
let A: string, B: string, C: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, { ...ctxFor(u, BASE), senders: fake.senders }, body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const status = async (id: string) => (await pool.query('select status from promises where id = $1', [id])).rows[0].status as string;
const errCode = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ActionError ? e.code : String(e); } };

async function active(amount = 300000, offset = 10) {
  const r = await act(A, { action: 'create', tpl: 'loan', fields: { aName: '박제훈', bName: '김민수', amount: String(amount), deadline: addDays(today, offset), method: '계좌이체' }, signature: SIG, agree: true });
  await act(B, { action: 'claim', code: r.code, consent: true });
  await act(B, { action: 'sign', id: r.id, version: await version(r.id as string), signature: SIG, agree: true });
  return r.id as string;
}

beforeAll(async () => {
  A = await newUser('빌려준'); B = await newUser('빌린'); C = await newUser('제삼');
  await pool.query(`update profiles set notify_email = 'b@ledger.test' where id = $1`, [B]);
  await pool.query(`update profiles set notify_email = 'a@ledger.test' where id = $1`, [A]);
});
afterAll(async () => { await pool.end(); });

describe('상환 장부 (부분 상환)', () => {
  it('B가 10만원 신고 → A 확인 → 진행 중 유지, 남은 20만원', async () => {
    const id = await active();
    await act(B, { action: 'report', id, version: await version(id), amount: '100000' });
    const r = await act(A, { action: 'confirm', id, version: await version(id) });
    expect(r).toMatchObject({ done: false, remaining: 200000 });
    expect(await status(id)).toBe('active');
    // A가 직접 받은 금액 기록 → 남은 금액보다 많으면 거부, 맞으면 완료
    expect(await errCode(act(A, { action: 'record_payment', id, version: await version(id), amount: '250000' }))).toBe('AMOUNT');
    expect(await errCode(act(B, { action: 'record_payment', id, version: await version(id), amount: '50000' }))).toBe('WRONG_ROLE');
    await act(A, { action: 'record_payment', id, version: await version(id), amount: '50000', note: '현금으로 받음' });
    const r2 = await act(A, { action: 'record_payment', id, version: await version(id), amount: '150000' });
    expect(r2.done).toBe(true);
    const pays = await asUser<{ amount: number; confirmed_by_a: boolean }>(B, 'select amount, confirmed_by_a from payments where promise_id = $1 order by created_at', [id]);
    expect(pays.map((p) => p.amount)).toEqual([100000, 50000, 150000]);
    expect(pays.every((p) => p.confirmed_by_a)).toBe(true);
  });
  it('신고 없이 "이행 완료로 처리"하면 남은 금액 전부를 장부에 남기고 완료', async () => {
    const id = await active(80000);
    await act(A, { action: 'record_payment', id, version: await version(id), amount: '30000' });
    const r = await act(A, { action: 'confirm', id, version: await version(id) });
    expect(r.done).toBe(true);
    const pays = await asUser<{ amount: number }>(A, 'select amount from payments where promise_id = $1 order by created_at', [id]);
    expect(pays.map((p) => p.amount)).toEqual([30000, 50000]);
  });
});

describe('분할 회차 알림', () => {
  it('분할을 수락하면 1회차 기한 3일 전에 B에게, 3일 지나면 A에게 알림', async () => {
    const id = await active(300000, -1); // 기한 하루 지남
    await act(B, { action: 'request', id, version: await version(id), kind: 'split', parts: 3, every: 14 });
    const [req] = await asUser<{ id: string }>(A, `select id from requests where promise_id = $1`, [id]);
    await act(A, { action: 'answer', id, version: await version(id), requestId: req.id, ok: true });
    const [p] = await asUser<{ installments: { date: string }[] }>(A, 'select installments from promises where id = $1', [id]);
    const first = p.installments[0].date;
    fake.sent.length = 0;
    const atMinus3 = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10) - 3, 1));
    const r = await runDaily(testDb, atMinus3, { promiseId: id, immediate: true });
    expect(r.log.some((l) => l.includes('1회차 1단계'))).toBe(true);
    expect((await runDaily(testDb, atMinus3, { promiseId: id })).log.filter((l) => l.includes('회차'))).toHaveLength(0); // 한 번만
    const atPlus3 = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 1, +first.slice(8, 10) + 3, 1));
    expect((await runDaily(testDb, atPlus3, { promiseId: id })).log.some((l) => l.includes('1회차 3단계'))).toBe(true);
  });
});

describe('여러 명 정산', () => {
  let made: { name: string; amount: number; code: string; id: string }[];
  let groupId: string;
  it('총액 12만원 · 멤버 3명 + 나 → 1인 3만원씩, 한 번 서명으로 3건', async () => {
    const r = await act(A, { action: 'group_create', total: '120000', members: ['오태양', '김하늘', '최수빈'], includeSelf: true, fields: { title: '부산 여행', aName: '한지민', deadline: addDays(today, 10), method: '토스 송금' }, signature: SIG, agree: true });
    made = r.made as typeof made; groupId = r.groupId as string;
    expect(made.map((m) => m.amount)).toEqual([30000, 30000, 30000]);
    const rows = await asUser<{ group_id: string; status: string; title: string }>(A, 'select group_id, status, title from promises where group_id = $1 order by title', [groupId]);
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.status === 'pending_b')).toBe(true);
  });
  it('멤버는 자기 것만 본다', async () => {
    await act(B, { action: 'claim', code: made[0].code, consent: true });
    expect(await asUser(B, 'select id from promises where group_id = $1', [groupId])).toHaveLength(1);
    expect(await asUser(C, 'select id from promises where group_id = $1', [groupId])).toHaveLength(0);
  });
  it('같은 이름 두 번, 21명은 거부', async () => {
    expect(await errCode(act(A, { action: 'group_create', total: '10000', members: ['가', '가'], fields: { aName: '나', deadline: addDays(today, 3) }, signature: SIG, agree: true }))).toBe('MEMBERS');
    expect(await errCode(act(A, { action: 'group_create', total: '1000000', members: Array.from({ length: 21 }, (_, i) => '멤버' + i), fields: { aName: '나', deadline: addDays(today, 3) }, signature: SIG, agree: true }))).toBe('MEMBERS');
  });
});
