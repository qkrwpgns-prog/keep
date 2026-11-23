// 이름 입력 서명(접근성): 증서의 이름과 같아야 하고, 방식이 기록·표시된다
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { eventText } from '../../supabase/functions/_shared/domain/events.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';
import { asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';

const now = new Date();
let A: string, B: string;
const act = (u: string, body: Record<string, unknown>) => handleAction(testDb, ctxFor(u, now), body);
const version = async (id: string) => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const expectErr = async (p: Promise<unknown>, code: string) =>
  expect(p).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === code);
const fields = { title: '이름 서명 약속', aName: '박 제훈', bName: '김민수', amount: '50000', deadline: addDays(kstToday(now), 10), method: '계좌이체' };

beforeAll(async () => { A = await newUser('작성자'); B = await newUser('상대방'); });
afterAll(async () => { await pool.end(); });

describe('이름 입력 서명', () => {
  it('증서의 이름과 다르면 거부, 띄어쓰기는 무시', async () => {
    await expectErr(act(A, { action: 'create', tpl: 'loan', fields, signature: { typed: '홍길동' }, agree: true }), 'SIGNATURE_NAME');
    await expectErr(act(A, { action: 'create', tpl: 'loan', fields, signature: { typed: '' }, agree: true }), 'SIGNATURE');
    const r = await act(A, { action: 'create', tpl: 'loan', fields, signature: { typed: '박제훈' }, agree: true }) as { id: string; code: string };
    await act(B, { action: 'claim', code: r.code, consent: true });
    await expectErr(act(B, { action: 'sign', id: r.id, version: await version(r.id), signature: { typed: '김민' }, agree: true }), 'SIGNATURE_NAME');
    await act(B, { action: 'sign', id: r.id, version: await version(r.id), signature: SIG, agree: true });

    const sigs = await act(A, { action: 'signatures', id: r.id }) as { A: { kind: string; name: string; strokes: unknown[] }; B: { strokes: unknown[] } };
    expect(sigs.A).toMatchObject({ kind: 'typed', name: '박제훈', strokes: [] });
    expect(sigs.B.strokes.length).toBeGreaterThan(0);

    const ev = await asUser<{ type: string; payload: Record<string, unknown> }>(A, `select type, payload from events where promise_id = $1 order by id`, [r.id]);
    expect(ev.find((e) => e.type === 'created')!.payload.sig_kind).toBe('typed');
    expect(ev.find((e) => e.type === 'signed')!.payload.sig_kind).toBeUndefined();
    expect(eventText(ev.find((e) => e.type === 'created')!, { a: '박제훈', b: '김민수' }).title).toContain('이름 입력 서명');
    const [row] = await asUser<{ status: string }>(A, 'select status from promises where id = $1', [r.id]);
    expect(row.status).toBe('active');
  });

  it('B도 이름 입력으로 서명할 수 있다', async () => {
    const r = await act(A, { action: 'create', tpl: 'loan', fields, signature: SIG, agree: true }) as { id: string; code: string };
    await act(B, { action: 'claim', code: r.code, consent: true });
    await act(B, { action: 'sign', id: r.id, version: await version(r.id), signature: { typed: ' 김 민수 ' }, agree: true });
    const sigs = await act(B, { action: 'signatures', id: r.id }) as { B: { kind: string; name: string } };
    expect(sigs.B).toMatchObject({ kind: 'typed', name: '김 민수' });
  });
});
