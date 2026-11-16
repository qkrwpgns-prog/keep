// 2단계: 알림과 재촉 통합 테스트 (로컬 PostgreSQL + 같은 서버 코드 + 가짜 발송기)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { flush, runDaily } from '../../supabase/functions/_shared/notify.ts';
import { noticeText } from '../../supabase/functions/_shared/domain/nudge.ts';
import { rowToDoc, type PartyRow, type PromiseRow } from '../../supabase/functions/_shared/domain/mapping.ts';
import { addDays, kstYmd } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, fakeSenders, newUser, pool, SIG, testDb } from './harness.ts';

// 어제 오전 10시(KST): 항상 과거라서 큐의 send_after가 바로 '보낼 차례'가 된다
const kst10 = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 1)); // 01:00 UTC = 10:00 KST
const BASE = kst10(new Date(Date.now() - 864e5 + 9 * 3600e3));
const today = kstYmd(BASE);

const fake = fakeSenders();
let A: string, B: string, C: string;
const ctx = (u: string | null) => ({ ...ctxFor(u, BASE), senders: fake.senders, appUrl: 'https://example.test/keep/' });
const act = (u: string | null, body: Record<string, unknown>) => handleAction(testDb, ctx(u), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const expectErr = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === code);
const sentTo = (who: string, title: RegExp) => fake.sent.filter((x) => x.to.includes(who) && title.test(x.title));

/** A가 만들고 B가 서명한 진행 중 약속 (기한 = 오늘 + offset) */
async function activePromise(offset: number, title = '테스트 약속') {
  const r = await act(A, { action: 'create', tpl: 'loan', fields: { title, aName: '박제훈', bName: '김민수', amount: '300000', deadline: addDays(today, offset), method: '계좌이체' }, signature: SIG, agree: true });
  await act(B, { action: 'claim', code: r.code, consent: true });
  await act(B, { action: 'sign', id: r.id, version: await version(r.id as string), signature: SIG, agree: true });
  return r as { id: string; code: string };
}

beforeAll(async () => {
  A = await newUser('작성자');
  B = await newUser('상대방');
  C = await newUser('제삼자');
  // B만 이 기기 푸시를 켬
  await pool.query(`insert into push_subscriptions (endpoint, user_id, keys) values ('https://push.test/b', $1, '{"p256dh":"x","auth":"y"}')`, [B]);
  await pool.query(`update profiles set notify_email = 'a@mail.test' where id = $1`, [A]);
  await pool.query(`update profiles set notify_email = 'b@mail.test' where id = $1`, [B]);
});
afterAll(async () => { await pool.end(); });

describe('동작 직후 상대에게 알림', () => {
  it('B가 서명하면 A에게 이메일이 간다(푸시 구독이 없으면 이메일만)', async () => {
    fake.sent.length = 0;
    await activePromise(30, '서명 알림');
    const toA = sentTo('a@mail.test', /서명했어요/);
    expect(toA).toHaveLength(1);
    expect(fake.sent.filter((x) => x.channel === 'push' && /서명했어요/.test(x.title))).toHaveLength(0);
  });
});

describe('매일 09:00 크론', () => {
  it('D-3에는 B에게 자동 알림(푸시+이메일), 같은 날 다시 돌려도 중복 없음', async () => {
    const p = await activePromise(3, 'D-3 약속');
    fake.sent.length = 0;
    const r1 = await runDaily(testDb, BASE, { appUrl: 'https://example.test/keep/' });
    expect(r1.log.some((l) => l.startsWith(p.code) && l.includes('1단계'))).toBe(true);
    await flush(testDb, fake.senders, { ids: r1.queued });
    expect(sentTo('push.test/b', /3일 전/)).toHaveLength(1);
    expect(sentTo('b@mail.test', /3일 전/)).toHaveLength(1);
    const r2 = await runDaily(testDb, BASE);
    expect(r2.log.filter((l) => l.startsWith(p.code))).toHaveLength(0);
    const ev = await asUser<{ type: string; payload: { stage: number } }>(A, `select type, payload from events where promise_id = $1 and type = 'reminder'`, [p.id]);
    expect(ev).toEqual([{ type: 'reminder', payload: { stage: 1, to: 'B' } }]);
  });

  it('D-day에도 B에게 알림', async () => {
    const p = await activePromise(0, 'D-day 약속');
    const r = await runDaily(testDb, BASE);
    expect(r.log).toContain(`${p.code}: 2단계 B 알림`);
  });

  it('D+3에는 A에게 "재촉할 때예요"', async () => {
    const p = await activePromise(-3, 'D+3 약속');
    fake.sent.length = 0;
    const r = await runDaily(testDb, BASE);
    await flush(testDb, fake.senders, { ids: r.queued });
    expect(r.log).toContain(`${p.code}: 3단계 A 안내`);
    expect(sentTo('a@mail.test', /재촉할 때예요/).length).toBeGreaterThan(0);
  });

  it('시연 약속은 전체 크론에서 건너뛰고, 콕 집어 실행할 때만 처리', async () => {
    const p = await activePromise(30, '시연 약속');
    await pool.query('update promises set is_demo = true, demo_offset_days = 3 where id = $1', [p.id]); // 시연 날짜 D+3
    expect((await runDaily(testDb, BASE)).log.some((l) => l.startsWith(p.code))).toBe(false);
    expect((await runDaily(testDb, BASE, { promiseId: p.id })).log).toContain(`${p.code}: 3단계 A 안내`);
  });
});

describe('재촉: 단계당 1회, A 승인 후 발송', () => {
  let p: { id: string; code: string };
  beforeAll(async () => { p = await activePromise(-3, '재촉 약속'); });

  it('지금 단계가 아니면 보낼 수 없다', async () => {
    await expectErr(act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 4, text: '확인 부탁해', tone: 2, rel: '친구' }), 'STAGE');
  });
  it('욕설·협박·과장된 법적 위협은 막는다', async () => {
    await expectErr(act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '안 갚으면 고소하겠다', tone: 5, rel: '친구' }), 'BANNED');
    await expectErr(act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '회사에 알릴 거야', tone: 5, rel: '친구' }), 'BANNED');
  });
  it('B는 재촉을 보낼 수 없다', async () => {
    await expectErr(act(B, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '안녕', tone: 2, rel: '친구' }), 'WRONG_ROLE');
  });
  it('A가 보내면 B에게 푸시+이메일, 같은 단계는 두 번 보낼 수 없다', async () => {
    fake.sent.length = 0;
    await act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '민수야 30만원 약속 기억나? 이번 주에 알려줘', tone: 2, rel: '친구' });
    expect(sentTo('push.test/b', /메시지/)).toHaveLength(1);
    expect(sentTo('b@mail.test', /메시지/)[0].body).toContain('30만원 약속 기억나');
    await expectErr(act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 3, text: '한 번 더', tone: 2, rel: '친구' }), 'ALREADY_SENT');
    const rows = await asUser<{ stage: number; status: string }>(B, 'select stage, status from nudges where promise_id = $1', [p.id]);
    expect(rows).toEqual([{ stage: 3, status: 'sent' }]);
  });
  it('DB도 같은 단계 중복 발송을 막는다', async () => {
    await expect(testDb.commit({ promise_id: p.id, version: await version(p.id), nudge_send: { stage: 3, message: 'x', tone: 1, relation: '' } })).rejects.toThrow(/NUDGE_ALREADY_SENT/);
  });
});

describe('B의 알림 끄기·신고', () => {
  it('B가 이 약속 알림을 끄면 재촉이 푸시·이메일로 가지 않는다', async () => {
    const p = await activePromise(-7, '알림 끈 약속');
    await asUser(B, 'insert into notification_prefs (user_id, promise_id, muted) values ($1, $2, true)', [B, p.id]);
    fake.sent.length = 0;
    await act(A, { action: 'nudge_send', id: p.id, version: await version(p.id), stage: 4, text: '2차로 연락했어. 날짜 알려줘', tone: 3, rel: '친구' });
    expect(fake.sent.filter((x) => x.to.includes('push.test/b') || x.to === 'b@mail.test')).toHaveLength(0);
  });
  it('당사자가 아닌 약속의 알림 설정은 만들 수 없다', async () => {
    const p = await activePromise(30, '남의 약속');
    await expect(asUser(C, 'insert into notification_prefs (user_id, promise_id, muted) values ($1, $2, true)', [C, p.id])).rejects.toThrow(/row-level security/);
  });
  it('B는 약속을 신고할 수 있다', async () => {
    const p = await activePromise(30, '신고 약속');
    await act(B, { action: 'abuse_report', id: p.id, reason: '모르는 사람이 계속 재촉해요' });
    expect((await pool.query('select reason from abuse_reports where promise_id = $1', [p.id])).rows[0].reason).toContain('모르는 사람');
    await expectErr(act(C, { action: 'abuse_report', id: p.id, reason: 'x' }), 'NOT_PARTY');
  });
});

describe('이행 촉구서 (D+14)', () => {
  it('법률 자문 아님 문구가 있어야 보낼 수 있고, B에게 전문이 간다', async () => {
    const p = await activePromise(-14, '촉구서 약속');
    const [row] = await asUser<PromiseRow>(A, 'select * from promises where id = $1', [p.id]);
    const parties = await asUser<PartyRow>(A, 'select promise_id, role, user_id, display_name, signature_sha256, signed_at, consent_at from parties where promise_id = $1', [p.id]);
    const text = noticeText(rowToDoc(row, parties), 0, today);
    await expectErr(act(A, { action: 'notice_send', id: p.id, version: await version(p.id), text: text.replace('법률 자문이 아닙니다', '') }), 'DISCLAIMER');
    fake.sent.length = 0;
    await act(A, { action: 'notice_send', id: p.id, version: await version(p.id), text });
    expect(sentTo('b@mail.test', /이행 촉구서/)[0].body).toContain('수신: 김민수');
  });
});

describe('발송 큐', () => {
  it('만료된 푸시 구독(410)은 지운다', async () => {
    await pool.query(`insert into push_subscriptions (endpoint, user_id, keys) values ('https://push.test/b-old', $1, '{"p256dh":"x","auth":"y"}')`, [B]);
    fake.gone.add('https://push.test/b-old');
    const p = await activePromise(30, '구독 정리');
    await act(A, { action: 'cancel', id: p.id, version: await version(p.id) }).catch(() => {}); // 진행 중이라 취소 불가 → 알림 없음
    await act(B, { action: 'report', id: p.id, version: await version(p.id), amount: '300000' }); // A에게 알림(A는 푸시 없음)
    await act(A, { action: 'reject', id: p.id, version: await version(p.id), note: '아직 안 들어왔어' }); // B에게 푸시
    expect((await pool.query(`select 1 from push_subscriptions where endpoint = 'https://push.test/b-old'`)).rowCount).toBe(0);
    expect((await pool.query(`select 1 from push_subscriptions where endpoint = 'https://push.test/b'`)).rowCount).toBe(1);
  });
  it('알림은 본인 것만 보인다', async () => {
    const mine = await asUser<{ id: number }>(B, 'select id from notifications');
    const all = (await pool.query('select id from notifications where user_id = $1', [B])).rows;
    expect(mine.length).toBe(all.length);
    expect(await asUser(C, 'select id from notifications')).toHaveLength(0);
    expect(await asUser(C, 'select id from nudges')).toHaveLength(0);
  });
  it('밤에 생긴 알림은 다음 날 오전 9시로 미뤄진다', async () => {
    const p = await activePromise(30, '야간 알림');
    const night = new Date(BASE.getTime() + 12 * 3600e3); // 같은 날 22:00 KST
    await handleAction(testDb, { ...ctxFor(A, night), senders: fake.senders }, { action: 'cancel', id: p.id, version: await version(p.id) }).catch(() => {});
    await handleAction(testDb, { ...ctxFor(B, night), senders: fake.senders }, { action: 'report', id: p.id, version: await version(p.id), note: '밤에 보냄' });
    const r = (await pool.query(`select send_after, status from notifications where promise_id = $1 and kind = 'report' order by id desc limit 1`, [p.id])).rows[0];
    expect(new Date(r.send_after).toISOString()).toBe(new Date(BASE.getTime() + 864e5 - 3600e3).toISOString()); // 다음 날 09:00 KST
  });
});
