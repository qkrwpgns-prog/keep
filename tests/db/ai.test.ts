// 3단계: AI 한도·권한·송금 캡처 저장 (Claude는 가짜 클라이언트)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError, handleAction } from '../../supabase/functions/_shared/actions.ts';
import { handleAi, noticeInput } from '../../supabase/functions/_shared/aiActions.ts';
import type { AiClient, AiEnv } from '../../supabase/functions/_shared/ai.ts';
import { addDays, kstYmd } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, files, newUser, pool, SIG, testDb } from './harness.ts';

const BASE = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 1) - 864e5);
const today = kstYmd(BASE);
let A: string, B: string, C: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctxFor(u, BASE), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const errCode = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ActionError ? e.code : String(e); } };

let calls = 0;
const client: AiClient = {
  json: async () => { calls++; return { messages: [{ label: '안부', text: '민수야 30만원 약속 기억나? 이번 주에 알려줘' }, { label: '날짜', text: '언제 가능한지 날짜로 알려줘' }, { label: '분할', text: '나눠서 줘도 괜찮아, 계획만 알려줘' }] }; },
  stream: async () => '',
};
const envFor = (limit: number): AiEnv => ({ client, fastModel: 'f', smartModel: 's', dailyLimit: limit, take: (u) => testDb.aiTake(u, limit) });

async function active(offset: number) {
  const r = await act(A, { action: 'create', tpl: 'loan', fields: { title: 'AI 약속', aName: '박제훈', bName: '김민수', amount: '300000', deadline: addDays(today, offset), method: '계좌이체' }, signature: SIG, agree: true });
  await act(B, { action: 'claim', code: r.code, consent: true });
  await act(B, { action: 'sign', id: r.id, version: await version(r.id as string), signature: SIG, agree: true });
  return r.id as string;
}

beforeAll(async () => { A = await newUser('작성'); B = await newUser('상대'); C = await newUser('남'); });
afterAll(async () => { await pool.end(); });

describe('AI 하루 한도', () => {
  it('한도까지만 허용하고, 넘으면 false', async () => {
    const U = await newUser('한도');
    const res = [];
    for (let i = 0; i < 4; i++) res.push(await testDb.aiTake(U, 3));
    expect(res).toEqual([true, true, true, false]);
    expect((await pool.query('select count from ai_usage where user_id = $1', [U])).rows[0].count).toBe(3);
  });
});

describe('AI 재촉 문구 권한·단계', () => {
  it('당사자 A만, D+3·D+7에만, 한도를 넘으면 LIMIT', async () => {
    const id = await active(-3);
    expect(await errCode(handleAi(testDb, ctxFor(C, BASE), envFor(30), { action: 'nudge', id }))).toBe('NOT_PARTY');
    expect(await errCode(handleAi(testDb, ctxFor(B, BASE), envFor(30), { action: 'nudge', id }))).toBe('WRONG_ROLE');
    const r = await handleAi(testDb, ctxFor(A, BASE), envFor(30), { action: 'nudge', id, rel: '친구', tone: 2 });
    expect(r).toMatchObject({ ai: true });
    const idEarly = await active(5);
    expect(await errCode(handleAi(testDb, ctxFor(A, BASE), envFor(30), { action: 'nudge', id: idEarly }))).toBe('STAGE');
    const before = calls;
    expect(await handleAi(testDb, ctxFor(A, BASE), envFor(0), { action: 'nudge', id })).toEqual({ ai: false, reason: 'LIMIT' });
    expect(calls).toBe(before); // 한도를 넘으면 Claude를 부르지 않는다
  });
  it('촉구서 초안은 D+14부터', async () => {
    expect(await errCode(noticeInput(testDb, ctxFor(A, BASE), await active(-7)))).toBe('STAGE');
    const facts = await noticeInput(testDb, ctxFor(A, BASE), await active(-14));
    expect(facts).toContain('수신(약속한 사람): 김민수');
    expect(facts).not.toMatch(/\d{3}-\d{3}-\d{6}/); // 계좌번호는 넘기지 않는다
  });
});

describe('송금 캡처 첨부', () => {
  it('이행 신고에 캡처를 붙이면 비공개 저장소에 저장되고, 당사자만 볼 수 있다', async () => {
    const id = await active(0);
    const reading = { readable: true, amount: 300000, date: today, sender: '김민수', receiver: '박제훈' };
    await act(B, { action: 'report', id, version: await version(id), amount: '300000', proof: { mediaType: 'image/jpeg', data: Buffer.from('fakejpeg').toString('base64') }, aiReading: reading });
    const [pay] = await asUser<{ id: string; ai_reading: Record<string, unknown> }>(A, 'select id, ai_reading from payments where promise_id = $1', [id]);
    expect(pay.ai_reading).toMatchObject({ amount: 300000, by: 'ai' });
    await expect(asUser(A, 'select proof_path from payments where promise_id = $1', [id])).rejects.toThrow(/permission denied/);
    const r = await act(A, { action: 'proof_url', id, paymentId: pay.id });
    expect(String(r.url)).toContain('/evidence/' + id);
    expect([...files.keys()].some((k) => k.startsWith('evidence/' + id))).toBe(true);
    expect(await errCode(act(C, { action: 'proof_url', id, paymentId: pay.id }))).toBe('NOT_PARTY');
  });
  it('이미지가 아니면 거부', async () => {
    const id = await active(0);
    expect(await errCode(act(B, { action: 'report', id, version: await version(id), amount: '300000', proof: { mediaType: 'application/pdf', data: 'AAAA' } }))).toBe('IMAGE');
  });
});
