// 4단계: 시연 모드 — 혼자 A·B 역할, 시간 되감기, cron 즉시 실행, 일반 목록과 분리
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionError, handleAction } from '../../supabase/functions/_shared/actions.ts';
import { asUser, ctxFor, fakeSenders, newUser, pool, SIG, testDb } from './harness.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';

// 밤 시간이어도 시연 알림은 바로 나가야 한다 → 일부러 어제 밤 23시(KST)로
const NIGHT = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate(), 14) - 864e5);
const fake = fakeSenders();
let U: string, O: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, { ...ctxFor(u, NIGHT), senders: fake.senders }, body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const errCode = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e) { return e instanceof ActionError ? e.code : String(e); } };

beforeAll(async () => {
  U = await newUser('시연자'); O = await newUser('다른사람');
  await pool.query(`update profiles set notify_email = 'demo@mail.test' where id = $1`, [U]);
});
afterAll(async () => { await pool.end(); });

describe('시연 약속', () => {
  let id: string;
  it('예시로 만들면 혼자 A·B 서명까지 끝난 진행 중 약속이 되고, 시연 표시가 붙는다', async () => {
    const r = await act(U, { action: 'demo_create', example: 'loan' });
    id = r.id as string;
    const [p] = await asUser<{ status: string; is_demo: boolean; title: string }>(U, 'select status, is_demo, title from promises where id = $1', [id]);
    expect(p).toMatchObject({ status: 'active', is_demo: true });
    expect(p.title).toMatch(/^\[시연\]/);
  });

  it('남의 시연 약속은 날짜를 바꿀 수 없고, 일반 약속도 바꿀 수 없다', async () => {
    expect(await errCode(act(O, { action: 'demo_offset', id, version: await version(id), offset: 3 }))).toBe('NOT_PARTY');
    const real = await act(U, { action: 'create', tpl: 'pledge', fields: { aName: '시연자', bName: '김철수', task: '청소', deadline: addDays(kstToday(), 5) }, signature: SIG, agree: true });
    expect(await errCode(act(U, { action: 'demo_offset', id: real.id, version: await version(real.id as string), offset: 3 }))).toBe('NOT_DEMO');
    expect(await errCode(act(U, { action: 'demo_cron', id: real.id }))).toBe('NOT_DEMO');
  });

  it('D-3으로 되감고 cron을 바로 실행하면 밤이어도 알림이 실제로 나간다(B 역할 = 같은 계정)', async () => {
    await act(U, { action: 'demo_offset', id, version: await version(id), offset: -3 });
    fake.sent.length = 0;
    const r = await act(U, { action: 'demo_cron', id });
    expect(r.result).toContain('1단계');
    expect(fake.sent.some((x) => x.to === 'demo@mail.test' && /3일 전/.test(x.title))).toBe(true);
    const again = await act(U, { action: 'demo_cron', id });
    expect(again.queued).toBe(0); // 같은 단계는 한 번만
  });

  it('D+3으로 되감으면 A 역할로 재촉을 보내고, B 역할로 이행 신고, A 역할로 확인까지 혼자 진행', async () => {
    await act(U, { action: 'demo_offset', id, version: await version(id), offset: 3 });
    await act(U, { action: 'demo_cron', id });
    await act(U, { action: 'nudge_send', id, version: await version(id), stage: 3, text: '민수야 약속 기억나? 이번 주에 알려줘', tone: 2, rel: '친구', as: 'A' });
    await act(U, { action: 'report', id, version: await version(id), amount: '300000', as: 'B' });
    const r = await act(U, { action: 'confirm', id, version: await version(id), as: 'A' });
    expect(r.done).toBe(true);
  });

  it('이벤트에는 실제 서버 시각과 시연 날짜가 함께 남는다', async () => {
    const ev = await asUser<{ type: string; created_at: string; sim_at: string | null }>(U, `select type, created_at, sim_at from events where promise_id = $1 and type in ('nudge_sent', 'demo_time', 'demo_cron') order by id`, [id]);
    expect(ev.length).toBeGreaterThan(2);
    for (const e of ev) { expect(e.created_at).toBeTruthy(); }
    const nudge = ev.find((e) => e.type === 'nudge_sent')!;
    const [p] = await asUser<{ deadline: string }>(U, 'select deadline from promises where id = $1', [id]);
    expect(nudge.sim_at).toBe(addDays(p.deadline, 3));
  });

  it('전체 크론은 시연 약속을 건드리지 않는다', async () => {
    const id2 = (await act(U, { action: 'demo_create', example: 'lend' })).id as string;
    await act(U, { action: 'demo_offset', id: id2, version: await version(id2), offset: 0 });
    const { runDaily } = await import('../../supabase/functions/_shared/notify.ts');
    await runDaily(testDb, NIGHT);
    const n = (await pool.query(`select count(*)::int c from nudges where promise_id = $1`, [id2])).rows[0].c;
    expect(n).toBe(0);
  });
});
