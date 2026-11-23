// 송금 바로가기: 링크는 본인만 쓰고, 상대방에게는 당사자 확인 후 서버로만
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';

const now = new Date();
let A: string, B: string, C: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctxFor(u, now), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;

beforeAll(async () => { A = await newUser('작성자'); B = await newUser('상대방'); C = await newUser('제삼자'); });
afterAll(async () => { await pool.end(); });

describe('송금 링크', () => {
  it('본인 프로필에만, 형식에 맞을 때만 저장된다', async () => {
    await asUser(A, `update profiles set pay_toss_id = 'keep_jh', pay_kakao_url = 'https://qr.kakaopay.com/Ej7AbC123' where id = $1`, [A]);
    expect((await asUser(A, 'select pay_toss_id, pay_kakao_url from profiles where id = $1', [A]))[0]).toEqual({ pay_toss_id: 'keep_jh', pay_kakao_url: 'https://qr.kakaopay.com/Ej7AbC123' });
    await expect(asUser(A, `update profiles set pay_kakao_url = 'https://evil.com/x' where id = $1`, [A])).rejects.toThrow(/check constraint/);
    await expect(asUser(A, `update profiles set pay_toss_id = '토스' where id = $1`, [A])).rejects.toThrow(/check constraint/);
    await asUser(C, `update profiles set pay_toss_id = 'hijack' where id = $1`, [A]); // RLS: 남의 행은 바뀌지 않음
    expect((await pool.query('select pay_toss_id from profiles where id = $1', [A])).rows[0].pay_toss_id).toBe('keep_jh');
  });

  it('상대방은 pay_info로 작성자 링크를 받고, 제삼자는 막힌다. 물건 약속은 비어 있다', async () => {
    const r = await act(A, { action: 'create', tpl: 'loan', fields: { title: '송금 약속', aName: '박제훈', bName: '김민수', amount: '50000', deadline: addDays(kstToday(now), 10), method: '토스 송금', repayAccount: '국민 123-456-789012' }, signature: SIG, agree: true }) as { id: string; code: string };
    await act(B, { action: 'claim', code: r.code, consent: true });
    await act(B, { action: 'sign', id: r.id, version: await version(r.id), signature: SIG, agree: true });
    expect(await act(B, { action: 'pay_info', id: r.id })).toEqual({ toss: 'keep_jh', kakao: 'https://qr.kakaopay.com/Ej7AbC123' });
    await expect(act(C, { action: 'pay_info', id: r.id })).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === 'NOT_PARTY');
    const item = await act(A, { action: 'create', tpl: 'lend', fields: { title: '스위치', aName: '박제훈', bName: '김민수', item: '스위치', deadline: addDays(kstToday(now), 10), method: '직접 전달' }, signature: SIG, agree: true }) as { id: string };
    expect(await act(A, { action: 'pay_info', id: item.id })).toEqual({ toss: null, kakao: null });
  });

  it('상대방은 작성자 프로필을 직접 읽을 수 없다', async () => {
    expect(await asUser(B, 'select pay_toss_id from profiles where id = $1', [A])).toEqual([]);
  });
});
