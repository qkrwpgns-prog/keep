// 수정 검증: 푸시 구독 저장, 다시 로그인해도 알림 이메일 유지
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, newUser, pool, testDb } from './harness.ts';

let A: string, B: string;
beforeAll(async () => { A = await newUser('구독자'); B = await newUser('다른계정'); });
afterAll(async () => { await pool.end(); });

describe('푸시 구독 (로그인 사용자 권한)', () => {
  it('구독을 저장하고, 같은 기기에 다른 계정이 로그인하면 그 계정으로 넘어간다', async () => {
    await asUser(A, `select keep_push_subscribe('https://push.test/dev1', '{"p256dh":"k","auth":"a"}')`);
    expect((await pool.query(`select user_id from push_subscriptions where endpoint = 'https://push.test/dev1'`)).rows[0].user_id).toBe(A);
    await asUser(A, `select keep_push_subscribe('https://push.test/dev1', '{"p256dh":"k2","auth":"a"}')`); // 다시 켜도 오류 없음
    await asUser(B, `select keep_push_subscribe('https://push.test/dev1', '{"p256dh":"k3","auth":"a"}')`);
    expect((await pool.query(`select user_id from push_subscriptions where endpoint = 'https://push.test/dev1'`)).rows[0].user_id).toBe(B);
  });
  it('남의 구독은 끊을 수 없고, 내 구독만 끊긴다', async () => {
    await asUser(A, `select keep_push_unsubscribe('https://push.test/dev1')`);
    expect((await pool.query(`select 1 from push_subscriptions where endpoint = 'https://push.test/dev1'`)).rowCount).toBe(1);
    await asUser(B, `select keep_push_unsubscribe('https://push.test/dev1')`);
    expect((await pool.query(`select 1 from push_subscriptions where endpoint = 'https://push.test/dev1'`)).rowCount).toBe(0);
  });
  it('https가 아닌 주소는 거부, 비로그인은 호출 불가', async () => {
    await expect(asUser(A, `select keep_push_subscribe('http://evil', '{}')`)).rejects.toThrow(/BAD_ENDPOINT/);
    await expect(asUser(null, `select keep_push_subscribe('https://x', '{}')`)).rejects.toThrow(/permission denied/);
  });
});

describe('다시 로그인해도 알림 이메일 유지', () => {
  it('프로필 행이 없으면 만들고, 알림 이메일이 비면 로그인 이메일로 채운다', async () => {
    await pool.query('delete from profiles where id = $1', [A]);
    const [r] = await asUser<{ p: { notify_email: string; display_name: string } }>(A, 'select keep_profile_ensure() as p');
    expect(r.p.notify_email).toMatch(/@example\.com$/);
    await pool.query('update profiles set notify_email = null, display_name = $2 where id = $1', [A, '박제훈']);
    const [r2] = await asUser<{ p: { notify_email: string; display_name: string } }>(A, 'select keep_profile_ensure() as p');
    expect(r2.p.notify_email).toMatch(/@example\.com$/);
    expect(r2.p.display_name).toBe('박제훈'); // 이름은 건드리지 않음
  });
  it('직접 정한 알림 이메일은 그대로 둔다', async () => {
    await pool.query(`update profiles set notify_email = 'mine@mail.test' where id = $1`, [A]);
    const [r] = await asUser<{ p: { notify_email: string } }>(A, 'select keep_profile_ensure() as p');
    expect(r.p.notify_email).toBe('mine@mail.test');
  });
  it('알림 이메일이 비어 있어도 로그인 이메일로 발송된다', async () => {
    await pool.query('update profiles set notify_email = null where id = $1', [B]);
    const ids = await testDb.enqueue({ user_id: B, promise_id: null, kind: 'test', title: 't', body: 'b', url: null, respect_mute: false });
    expect(ids.length).toBe(1);
    const due = await testDb.claimDue(10, ids);
    expect(due[0].email).toMatch(/@example\.com$/);
  });
  it('이메일 알림을 끈 사람에게는 보내지 않는다', async () => {
    await pool.query('update profiles set notify_email_on = false where id = $1', [B]);
    expect(await testDb.enqueue({ user_id: B, promise_id: null, kind: 'test', title: 't', body: 'b', url: null, respect_mute: false })).toEqual([]);
  });
});
