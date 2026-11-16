// 두 계정 통합 테스트 + RLS 증명
// 서로 다른 두 계정(A, B)이 작성→서명→확정하고, 당사자가 아닌 계정(C)과 비로그인(anon)은 읽기가 막히는지 확인한다.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleAction, publicPreview, ActionError } from '../../supabase/functions/_shared/actions.ts';
import { rowToDoc, type PartyRow, type PromiseRow } from '../../supabase/functions/_shared/domain/mapping.ts';
import { certHashV3, eventHash, canonicalV2, sha256Hex } from '../../supabase/functions/_shared/domain/canonical.ts';
import { asUser, ctxFor, newUser, pool, SIG, testDb } from './harness.ts';
import { addDays, kstToday } from '../../supabase/functions/_shared/domain/dates.ts';

const deadline = addDays(kstToday(), 30);
const fields = { title: '민수 월세 30만원', aName: '박제훈', bName: '김민수', amount: '300000', deadline, method: '계좌이체', penalty: '늦으면 밥 한 번 사기', repayAccount: '국민 123-456-789012' };

let A: string, B: string, C: string;
let id: string, code: string;

const act = (user: string | null, body: Record<string, unknown>) => handleAction(testDb, ctxFor(user), body);
const version = async () => (await pool.query('select version from promises where id = $1', [id])).rows[0].version as number;
const expectErr = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof ActionError && e.code === code);
};

async function readAsParty(user: string) {
  const [p] = await asUser<PromiseRow>(user, 'select * from promises where id = $1', [id]);
  const parties = await asUser<PartyRow>(user, 'select promise_id, role, user_id, display_name, signature_sha256, signed_at, consent_at from parties where promise_id = $1', [id]);
  return { p, parties };
}

beforeAll(async () => {
  A = await newUser('박제훈');
  B = await newUser('김민수');
  C = await newUser('제삼자');
});
afterAll(async () => { await pool.end(); });

describe('작성 → 서명 → 확정 (서로 다른 두 계정)', () => {
  it('로그인 없이는 서명(작성)할 수 없다', async () => {
    await expectErr(act(null, { action: 'create', tpl: 'loan', fields, signature: SIG, agree: true }), 'LOGIN');
  });

  it('A가 작성·서명하면 서명 대기 상태와 공유 코드가 생긴다', async () => {
    const r = await act(A, { action: 'create', tpl: 'loan', fields, signature: SIG, agree: true, quote: '다음 달 15일에 보낼게' });
    id = r.id as string; code = r.code as string;
    expect(code).toMatch(/^[23456789A-HJKMNP-Z]{8}$/);
    const { p } = await readAsParty(A);
    expect(p.status).toBe('pending_b');
  });

  it('로그인 전 미리보기는 이름을 가리고 계좌·이벤트를 주지 않는다', async () => {
    const pv = await publicPreview(testDb, ctxFor(null), code.toLowerCase());
    expect(pv.aName).toBe('박*훈');
    expect(pv.bName).toBe('김*수');
    expect(pv).not.toHaveProperty('repayAccount');
    expect(pv.hasAccount).toBe(true);
  });

  it('B 연결 전에는 B도 C도 약속을 읽을 수 없다', async () => {
    expect(await asUser(B, 'select id from promises where id = $1', [id])).toHaveLength(0);
    expect(await asUser(C, 'select id from promises where id = $1', [id])).toHaveLength(0);
  });

  it('동의 없이는 연결되지 않고, 동의하면 B가 연결된다', async () => {
    await expectErr(act(B, { action: 'claim', code, consent: false }), 'CONSENT');
    const r = await act(B, { action: 'claim', code, consent: true });
    expect(r.role).toBe('B');
    expect(await asUser(B, 'select id from promises where id = $1', [id])).toHaveLength(1);
  });

  it('이미 B가 연결된 약속에 C는 연결할 수 없다', async () => {
    await expectErr(act(C, { action: 'claim', code, consent: true }), 'TAKEN');
  });

  it('A는 상대방 자리에서 서명할 수 없다', async () => {
    await expectErr(act(A, { action: 'sign', id, version: await version(), signature: SIG, agree: true }), 'WRONG_ROLE');
  });

  it('오래된 버전으로는 서명할 수 없다', async () => {
    await expectErr(act(B, { action: 'sign', id, version: (await version()) - 1, signature: SIG, agree: true }), 'VERSION_CONFLICT');
  });

  it('B가 서명하면 증서가 확정되고 양쪽에서 같은 확인코드가 계산된다', async () => {
    const r = await act(B, { action: 'sign', id, version: await version(), signature: SIG, agree: true });
    for (const u of [A, B]) {
      const { p, parties } = await readAsParty(u);
      expect(p.status).toBe('active');
      const doc = rowToDoc(p, parties);
      expect(doc.sigA && doc.sigB).toBeTruthy();
      expect(await certHashV3(doc)).toBe(r.hash);
      expect(p.current_hash).toBe(r.hash);
    }
  });

  it('이벤트 해시 체인이 처음부터 끝까지 이어진다', async () => {
    const ev = await asUser<{ canon: string; created_at: string; prev_hash: string | null; hash: string; type: string }>(B, 'select * from events where promise_id = $1 order by id', [id]);
    expect(ev.map((e) => e.type)).toEqual(['created', 'joined', 'signed']);
    let prev: string | null = null;
    for (const e of ev) {
      expect(e.prev_hash).toBe(prev);
      expect(await eventHash(prev, e.canon, e.created_at)).toBe(e.hash);
      prev = e.hash;
    }
  });
});

describe('RLS: 당사자가 아닌 계정·비로그인은 막힌다', () => {
  it('C(로그인한 제3자)는 약속·당사자·이벤트·요청·상환을 한 줄도 못 읽는다', async () => {
    for (const t of ['promises', 'events', 'requests']) {
      expect(await asUser(C, `select * from ${t}`)).toHaveLength(0);
    }
    expect(await asUser(C, 'select id, amount from payments')).toHaveLength(0);
    expect(await asUser(A, 'select id, amount from payments where promise_id = $1', [id])).toHaveLength(0); // 아직 신고 전
    expect(await asUser(C, 'select promise_id from parties')).toHaveLength(0);
  });

  it('비로그인(anon)은 테이블 자체에 권한이 없다', async () => {
    await expect(asUser(null, 'select * from promises')).rejects.toThrow(/permission denied/);
  });

  it('당사자도 상태를 직접 바꾸거나 이벤트를 넣을 수 없다', async () => {
    await expect(asUser(A, `update promises set status = 'done' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(asUser(B, `insert into events (promise_id, actor_role, type, canon, hash) values ($1, 'B', 'done', '{}', 'x')`, [id])).rejects.toThrow(/permission denied/);
    await expect(asUser(A, `delete from parties where promise_id = $1`, [id])).rejects.toThrow(/permission denied/);
  });

  it('상대의 IP·UA는 열 권한으로 막혀 있다', async () => {
    await expect(asUser(A, 'select signer_ip from parties where promise_id = $1', [id])).rejects.toThrow(/permission denied/);
  });

  it('서버 권한으로도 이벤트는 수정·삭제할 수 없다', async () => {
    await expect(pool.query(`update events set type = 'x' where promise_id = $1`, [id])).rejects.toThrow(/수정하거나 지울 수 없습니다/);
    await expect(pool.query(`delete from events where promise_id = $1`, [id])).rejects.toThrow(/수정하거나 지울 수 없습니다/);
  });

  it('keep_* 함수는 클라이언트 역할로 실행할 수 없다', async () => {
    await expect(asUser(A, `select keep_commit('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
  });
});

describe('연장 요청 → 수락 → 이행 신고 → 확인', () => {
  it('B의 연장 요청을 A가 수락하면 변경 이력이 증서에 남고 확인코드가 바뀐다', async () => {
    const before = (await readAsParty(A)).p.current_hash;
    await act(B, { action: 'request', id, version: await version(), kind: 'extend', newDeadline: addDays(deadline, 7), note: '알바비가 늦게 들어와' });
    const [req] = await asUser<{ id: string }>(A, `select id from requests where promise_id = $1 and status = 'pending'`, [id]);
    const r = await act(A, { action: 'answer', id, version: await version(), requestId: req.id, ok: true });
    const { p, parties } = await readAsParty(B);
    expect(p.deadline).toBe(addDays(deadline, 7));
    expect(p.amendments).toHaveLength(1);
    expect(r.hash).not.toBe(before);
    expect(await certHashV3(rowToDoc(p, parties))).toBe(r.hash);
  });

  it('B가 이행을 신고하고 A가 확인하면 완료된다', async () => {
    await expectErr(act(B, { action: 'confirm', id, version: await version() }), 'WRONG_ROLE');
    await act(B, { action: 'report', id, version: await version(), amount: '300000', note: '토스로 보냈어' });
    expect((await readAsParty(A)).p.status).toBe('reported');
    const r = await act(A, { action: 'confirm', id, version: await version() });
    expect(r.done).toBe(true);
    expect((await readAsParty(B)).p.status).toBe('done');
    const [pay] = await asUser<{ confirmed_by_a: boolean; amount: number }>(B, 'select confirmed_by_a, amount from payments where promise_id = $1', [id]);
    expect(pay).toMatchObject({ confirmed_by_a: true, amount: 300000 });
  });
});

describe('가드레일', () => {
  it('이자율 20% 초과는 서버와 DB 양쪽에서 막는다', async () => {
    await expectErr(act(A, { action: 'create', tpl: 'loan', fields: { ...fields, interestRate: '24' }, signature: SIG, agree: true }), 'RATE_CAP');
    await expect(pool.query(`update promises set interest_rate = 25 where id = $1`, [id])).rejects.toThrow(/check constraint/);
  });

  it('이자 있는 차용증을 반복해 만들면 대부업 안내가 나온다', async () => {
    const U = await newUser('반복');
    const notices: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await act(U, { action: 'create', tpl: 'loan', fields: { ...fields, interestRate: '5' }, signature: SIG, agree: true });
      notices.push(String(r.notice || ''));
    }
    expect(notices[0]).toBe('');
    expect(notices[2]).toMatch(/미등록 대부업/);
  });
});

describe('수정 요청·거절', () => {
  it('B가 수정 요청 → A가 고쳐 다시 서명 → B가 서명 거절', async () => {
    const r = await act(A, { action: 'create', tpl: 'lend', fields: { ...fields, item: '닌텐도 스위치' }, signature: SIG, agree: true });
    const pid = r.id as string;
    await act(B, { action: 'claim', code: r.code, consent: true });
    const v = async () => (await pool.query('select version from promises where id = $1', [pid])).rows[0].version as number;
    await act(B, { action: 'revise', id: pid, version: await v(), note: '케이스도 포함해 주세요' });
    await act(A, { action: 'update', id: pid, version: await v(), tpl: 'lend', fields: { ...fields, item: '닌텐도 스위치 (케이스 포함)' }, signature: SIG, agree: true });
    const [p] = await asUser<PromiseRow>(B, 'select * from promises where id = $1', [pid]);
    expect(p.status).toBe('pending_b');
    expect(p.item).toBe('닌텐도 스위치 (케이스 포함)');
    await act(B, { action: 'decline', id: pid, version: await v(), note: '생각해 보니 안 빌렸어' });
    const [p2] = await asUser<PromiseRow>(A, 'select status from promises where id = $1', [pid]);
    expect(p2.status).toBe('declined');
  });
});

describe('기존 버전 가져오기', () => {
  it('legacy 증서를 가져오면 기존 확인코드를 다시 계산해 검증한다', async () => {
    const legacy = {
      id: 'mabc12xyz', tpl: 'loan', title: '민수 30만원', aName: '박제훈', bName: '김민수', amount: 300000, deadline,
      method: '계좌이체', penalty: '', memo: '', installments: [], amendments: [], status: 'active', myRole: 'A', createdAt: Date.now(),
      sigA: { name: '박제훈', at: 1760000000000, ph: '1234', sv: SIG, svHash: 'aa' },
      sigB: { name: '김민수', at: 1760000100000, ph: '5678', sv: SIG, svHash: 'bb' },
      events: [{ at: 1760000000000, text: '박제훈님이 증서를 작성하고 서명' }],
    } as Record<string, unknown>;
    legacy.hash = await sha256Hex(canonicalV2(legacy as never));
    const r = await act(A, { action: 'import', legacy });
    expect(r.verified).toBe(true);
    await expectErr(act(A, { action: 'import', legacy }), 'ALREADY');
  });
});

describe('탈퇴 정책 (가)', () => {
  it('서명 미완료 약속은 지우고, 양측 서명 완료 증서는 상대의 증거로 남긴다', async () => {
    const D = await newUser('탈퇴자');
    const done = await act(D, { action: 'create', tpl: 'pledge', fields: { ...fields, task: '발표 자료 만들기' }, signature: SIG, agree: true });
    await act(B, { action: 'claim', code: done.code, consent: true });
    const v = (await pool.query('select version from promises where id = $1', [done.id])).rows[0].version;
    await act(B, { action: 'sign', id: done.id, version: v, signature: SIG, agree: true });
    const pending = await act(D, { action: 'create', tpl: 'pledge', fields: { ...fields, task: '청소' }, signature: SIG, agree: true });

    const r = await pool.query('select keep_delete_account($1) as v', [D]);
    expect(r.rows[0].v.deleted).toHaveLength(1);
    expect((await pool.query('select 1 from promises where id = $1', [pending.id])).rowCount).toBe(0);

    const kept = await asUser<PromiseRow>(B, 'select * from promises where id = $1', [done.id]);
    expect(kept).toHaveLength(1);
    expect(kept[0].retain_until).toBeTruthy();
    const ps = (await pool.query(`select user_id, signer_ip, signer_ua from parties where promise_id = $1 and role = 'A'`, [done.id])).rows[0];
    expect(ps).toEqual({ user_id: null, signer_ip: '203.0.*.*', signer_ua: 'iOS' });
  });
});
