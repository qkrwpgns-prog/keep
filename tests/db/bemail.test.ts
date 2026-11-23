// 상대 이메일로만 서명 가능(선택)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError, handleAction, publicPreview } from '../../supabase/functions/_shared/actions.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';

let A: string, B: string, C: string, emailB: string, emailC: string;
const mail = async (u: string) => (await pool.query('select email from auth.users where id = $1', [u])).rows[0].email as string;
const act = (u: string, email: string | null, body: Record<string, unknown>) => handleAction(testDb, { ...ctxFor(u), userEmail: email }, body);
const errCode = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ActionError ? e.code : String(e); } };
const fields = { aName: '박제훈', bName: '김민수', amount: '50000', deadline: addDays(kstToday(), 10), method: '계좌이체' };

beforeAll(async () => {
  A = await newUser('작성'); B = await newUser('지정된상대'); C = await newUser('링크주운사람');
  emailB = await mail(B); emailC = await mail(C);
});
afterAll(async () => { await pool.end(); });

describe('상대 이메일 지정', () => {
  it('지정하면 다른 이메일 계정은 연결할 수 없고, 지정한 계정만 연결된다', async () => {
    const r = await act(A, null, { action: 'create', tpl: 'loan', fields, bEmail: emailB.toUpperCase(), signature: SIG, agree: true });
    const pv = await publicPreview(testDb, ctxFor(null), r.code as string);
    expect(pv.bEmailHint).toMatch(/^.\*+@example\.com$/);
    expect(await errCode(act(C, emailC, { action: 'claim', code: r.code, consent: true }))).toBe('EMAIL_MISMATCH');
    expect(await errCode(act(B, emailB, { action: 'claim', code: r.code, consent: true }))).toBe('OK');
    const [p] = await asUser<{ linked_hint: string; expected_email: string }>(A, `select linked_hint, expected_email from parties where promise_id = $1 and role = 'B'`, [r.id]);
    expect(p.expected_email).toBe(emailB.toLowerCase());
    expect(p.linked_hint).toMatch(/\*+@example\.com$/);
  });
  it('지정하지 않으면 지금처럼 링크를 가진 계정이 연결된다', async () => {
    const r = await act(A, null, { action: 'create', tpl: 'loan', fields, signature: SIG, agree: true });
    expect(await errCode(act(C, emailC, { action: 'claim', code: r.code, consent: true }))).toBe('OK');
  });
  it('형식이 틀린 이메일은 거부', async () => {
    expect(await errCode(act(A, null, { action: 'create', tpl: 'loan', fields, bEmail: 'not-an-email', signature: SIG, agree: true }))).toBe('B_EMAIL');
  });
  it('상대가 연결되기 전에는 수정하면서 지정 이메일을 바꿀 수 있다', async () => {
    const r = await act(A, null, { action: 'create', tpl: 'loan', fields, bEmail: emailC, signature: SIG, agree: true });
    const v = (await pool.query('select version from promises where id = $1', [r.id])).rows[0].version;
    await act(A, null, { action: 'update', id: r.id, version: v, tpl: 'loan', fields, bEmail: emailB, signature: SIG, agree: true });
    expect(await errCode(act(B, emailB, { action: 'claim', code: r.code, consent: true }))).toBe('OK');
  });
});
