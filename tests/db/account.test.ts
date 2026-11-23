// 알림 이메일 변경 인증
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError } from '../../supabase/functions/_shared/actions.ts';
import { handleAccount, type AccountDb } from '../../supabase/functions/_shared/accountActions.ts';
import { asUser, ctxFor, fakeSenders, newUser, pool, testDb } from './harness.ts';

const fake = fakeSenders();
let U: string;
const q = async <T>(sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0]?.v as T;
const db: AccountDb = {
  rateCheck: testDb.rateCheck,
  loginEmail: (uid) => q('select email as v from auth.users where id = $1', [uid]),
  emailSetPending: async (uid, e, h) => { await pool.query('select keep_email_set_pending($1, $2, $3)', [uid, e, h]); },
  emailSetDirect: async (uid, e) => { await pool.query('select keep_email_set_direct($1, $2)', [uid, e]); },
  emailVerify: (uid, h) => q('select keep_email_verify($1, $2) as v', [uid, h]),
};
const acc = (body: Record<string, unknown>) => handleAccount(db, { ...ctxFor(U), senders: fake.senders }, body);
const errCode = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ActionError ? e.code : String(e); } };
const notify = async () => (await pool.query('select notify_email from profiles where id = $1', [U])).rows[0].notify_email as string | null;
const lastCode = () => /(\d{6})/.exec(fake.sent[fake.sent.length - 1].title)![1];

beforeAll(async () => { U = await newUser('메일변경'); });
afterAll(async () => { await pool.end(); });

describe('알림 이메일 변경', () => {
  it('클라이언트는 알림 이메일을 직접 바꿀 수 없다', async () => {
    await expect(asUser(U, `update profiles set notify_email = 'victim@other.test' where id = $1`, [U])).rejects.toThrow(/permission denied/);
    // 이름·알림 켜기는 여전히 직접 바꿀 수 있다
    await asUser(U, `update profiles set display_name = '새이름', notify_email_on = true where id = $1`, [U]);
  });
  it('새 주소로 코드를 보내고, 맞는 코드를 넣어야 바뀐다', async () => {
    const before = await notify();
    await acc({ action: 'email_request', email: 'New@Mail.test' });
    expect(fake.sent.at(-1)!.to).toBe('new@mail.test');
    expect(await notify()).toBe(before); // 아직 안 바뀜
    expect(await errCode(acc({ action: 'email_verify', code: '000000' === lastCode() ? '111111' : '000000' }))).toBe('MISMATCH');
    await acc({ action: 'email_verify', code: lastCode() });
    expect(await notify()).toBe('new@mail.test');
  });
  it('다섯 번 틀리면 잠기고, 맞는 코드도 거부', async () => {
    await acc({ action: 'email_request', email: 'third@mail.test' });
    const good = lastCode(), bad = good === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await errCode(acc({ action: 'email_verify', code: bad }));
    expect(await errCode(acc({ action: 'email_verify', code: good }))).toBe('LOCKED');
    expect(await notify()).toBe('new@mail.test');
  });
  it('만료된 코드는 거부', async () => {
    await acc({ action: 'email_request', email: 'late@mail.test' });
    await pool.query(`update profiles set notify_email_code_expires = now() - interval '1 minute' where id = $1`, [U]);
    expect(await errCode(acc({ action: 'email_verify', code: lastCode() }))).toBe('EXPIRED');
  });
  it('로그인 이메일로 되돌릴 때는 코드 없이 바로', async () => {
    const login = await q<string>('select email as v from auth.users where id = $1', [U]);
    const r = await acc({ action: 'email_request', email: login });
    expect(r).toEqual({ verified: true });
    expect(await notify()).toBe(login.toLowerCase());
  });
});
