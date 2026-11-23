// promise-action의 핵심 로직. 런타임(Deno·Node)과 저장소(supabase-js·pg)에 의존하지 않도록
// Db 인터페이스로 분리했다 → 배포 환경과 로컬 통합 테스트가 같은 코드를 실행한다.

import { TPL, isTemplateKey, type PromiseStatus, type TemplateKey } from './domain/templates.ts';
import { addDays, diffDays, isYmd, kstToday, korDate } from './domain/dates.ts';
import { certHashV3, canonicalV2, jcs, sha256Hex, type LegacyPromise } from './domain/canonical.ts';
import { repeatError, repeatPlan, type RepeatRule } from './domain/repeat.ts';
import { DEMO_SIG, normName, signatureFile, typedName, typedSignatureFile, validateVector } from './domain/signature.ts';
import { EXAMPLES } from './domain/examples.ts';
import { ruleExtract } from './domain/rules.ts';
import { checkRates, parseRate, REPEAT_LOAN_NOTICE, REPEAT_INTEREST_LOAN_THRESHOLD, REPEAT_WINDOW_DAYS } from './domain/guardrails.ts';
import { newShareCode, normalizeShareCode, rowToDoc, SHARE_CODE_RE, type PartyRow, type PromiseRow } from './domain/mapping.ts';
import { maskEmail, maskName } from './domain/korean.ts';
import { checkBanned } from './domain/nudge.ts';
import { promiseStage, splitPlan, subjectText } from './domain/progress.ts';
import { splitShares } from './domain/ledger.ts';
import { shortCode as shortHash } from './domain/canonical.ts';
import { DEFAULT_APP_URL, enqueue, flush, promiseUrl, runDaily, type NotifyDb, type Senders } from './notify.ts';
import { IMAGE_MIMES, validateProof, type ImageMime } from './ai.ts';
import type { Installment, PromiseDoc, SigVector } from './domain/types.ts';

export const CONSENT_VERSION = '2026-11-v1';

export interface RequestRow { id: string; kind: 'extend' | 'split'; new_deadline: string | null; installments: Installment[] | null; note: string | null; status: string }
export interface PaymentRow { id: string; amount: number | null; paid_on: string | null; installment_no: number | null; note: string | null; confirmed_by_a: boolean | null }
export interface NudgeSnap { stage: number; status: string; message: string | null; deadline_version: number; created_at: string; sent_at: string | null }
export interface Snapshot { promise: PromiseRow & { revise_note?: string | null; legacy_doc?: unknown; canonical_version?: number }; parties: (PartyRow & { signature_path: string | null; signer_ip: string | null; signer_ua: string | null })[]; requests: RequestRow[]; payments: (PaymentRow & { proof_path?: string | null })[]; nudges?: NudgeSnap[] }

export interface Db extends NotifyDb {
  abuseReport(promiseId: string, userId: string, reason: string): Promise<void>;
  /** B 진입 퍼널 단계 기록(약속별 첫 도달 시각·횟수만) */
  funnelMark(promiseId: string, step: 'view' | 'otp' | 'login'): Promise<void>;
  /** 작성자(A)가 등록한 송금 링크 */
  payLinks(promiseId: string): Promise<{ toss?: string | null; kakao?: string | null }>;
  aiTake(userId: string, limit: number, global: number): Promise<'ok' | 'user' | 'global'>;
  putBinary(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  signedUrl(bucket: string, path: string, seconds: number): Promise<string | null>;
  snapshot(q: { id?: string; code?: string }): Promise<Snapshot | null>;
  create(p: Record<string, unknown>): Promise<{ id: string; version: number }>;
  commit(p: Record<string, unknown>): Promise<{ version: number; event_hash: string | null }>;
  putFile(bucket: string, path: string, body: string, contentType: string): Promise<void>;
  getFile(bucket: string, path: string): Promise<string | null>;
  rateCheck(key: string, limit: number, windowSec: number): Promise<boolean>;
  countInterestLoans(userId: string, days: number): Promise<number>;
}

export interface Ctx { userId: string | null; userEmail?: string | null; ip: string; ua: string; now: Date; senders?: Senders; appUrl?: string; ipSource?: string }

export class ActionError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const fail = (status: number, code: string, message: string): never => { throw new ActionError(status, code, message); };

// ------------------------------------------------------------------ 입력 정리
type Body = Record<string, unknown>;
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const intOrNull = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return n > 0 ? n : null; };

export interface CleanFields {
  title: string; aName: string; bName: string; amount: number | null; interestRate: number | null; lateInterestRate: number | null;
  repayAccount: string; item: string; task: string; deadline: string; method: string; penalty: string; memo: string;
}

/**
 * 반복 약속(돈 약속만): 규칙으로 회차를 만들고 금액(회당×횟수)·기한(마지막 회차)을 덮어쓴다.
 * 규칙이 없으면 회차 없이 그대로.
 */
export function applyRepeat(tpl: TemplateKey, f: CleanFields, raw: unknown, today: string): { f: CleanFields; installments: Installment[]; rule: RepeatRule | null } {
  if (raw == null || raw === false) return { f, installments: [], rule: null };
  if (TPL[tpl].kind !== 'money') fail(400, 'REPEAT', '반복 약속은 돈 약속(차용·정산)에서만 쓸 수 있어요.');
  const r = raw as Record<string, unknown>;
  const rule = { every: r.every, count: Number(r.count), per: Number(r.per), first: str(r.first, 10) } as RepeatRule;
  const err = repeatError(rule, today);
  if (err) fail(400, 'REPEAT', err);
  const installments = repeatPlan(rule);
  const out = { ...f, amount: rule.per * rule.count, deadline: installments[installments.length - 1].date };
  if (out.amount > 10_000_000_000) fail(400, 'AMOUNT', '금액이 너무 커요.');
  const rc = checkRates({ amount: out.amount, interestRate: out.interestRate, lateInterestRate: out.lateInterestRate });
  if (!rc.ok) fail(400, 'RATE_CAP', rc.error!);
  return { f: out, installments, rule };
}

export function cleanFields(tpl: TemplateKey, f: Body): CleanFields {
  const kind = TPL[tpl].kind;
  const out: CleanFields = {
    title: str(f.title, 80),
    aName: str(f.aName, 40),
    bName: str(f.bName, 40),
    amount: kind === 'money' ? intOrNull(f.amount) : null,
    interestRate: tpl === 'loan' ? parseRate(f.interestRate as string) : null,
    lateInterestRate: tpl === 'loan' ? parseRate(f.lateInterestRate as string) : null,
    repayAccount: kind === 'money' ? str(f.repayAccount, 80) : '',
    item: kind === 'item' ? str(f.item, 200) : '',
    task: kind === 'task' ? str(f.task, 500) : '',
    deadline: str(f.deadline, 10),
    method: str(f.method, 100),
    penalty: str(f.penalty, 200),
    memo: str(f.memo, 500),
  };
  if (!out.title) out.title = (TPL[tpl].name + ' · ' + out.bName).slice(0, 80);
  const miss: string[] = [];
  if (!out.aName) miss.push('내 이름');
  if (!out.bName) miss.push('상대 이름');
  if (!isYmd(out.deadline)) miss.push('기한');
  if (kind === 'money' && !out.amount) miss.push('금액');
  if (kind === 'item' && !out.item) miss.push('물건');
  if (kind === 'task' && !out.task) miss.push('약속 내용');
  if (miss.length) fail(400, 'MISSING', miss.join(', ') + '을(를) 채워 주세요.');
  if (out.amount && out.amount > 10_000_000_000) fail(400, 'AMOUNT', '금액이 너무 커요.');
  const rc = checkRates({ amount: out.amount, interestRate: out.interestRate, lateInterestRate: out.lateInterestRate });
  if (!rc.ok) fail(400, 'RATE_CAP', rc.error!);
  return out;
}

function fieldsToRow(f: CleanFields) {
  return {
    title: f.title, amount: f.amount, interest_rate: f.interestRate, late_interest_rate: f.lateInterestRate,
    repay_account: f.repayAccount || null, item: f.item || null, task: f.task || null, deadline: f.deadline,
    method: f.method || null, penalty: f.penalty || null, memo: f.memo || null,
  };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** 상대 지정 이메일(선택): 비우면 null, 형식이 틀리면 오류 */
const cleanBEmail = (v: unknown): string | null => {
  const e = String(v ?? '').trim().toLowerCase().slice(0, 200);
  if (!e) return null;
  if (!EMAIL_RE.test(e)) fail(400, 'B_EMAIL', '상대 이메일 주소를 확인해 주세요.');
  return e;
};

const event = (actor: 'A' | 'B' | 'system', type: string, payload: Record<string, unknown>, simAt?: string | null) =>
  ({ actor_role: actor, type, canon: jcs(payload), sim_at: simAt || null });

/** 손글씨(획 벡터) 또는 이름 입력 서명을 저장. 이름 입력은 증서의 이름(name)과 같아야 한다 */
async function saveSignature(db: Db, promiseId: string, role: 'A' | 'B', input: unknown, n: number, name?: string) {
  const typed = typedName(input);
  let file: { body: string; sha: string };
  if (typed) {
    if (!name || normName(typed) !== normName(name)) fail(400, 'SIGNATURE_NAME', `증서에 적힌 이름(${name || ''})과 똑같이 입력해 주세요.`);
    file = await typedSignatureFile(typed);
  } else {
    if (!validateVector(input)) fail(400, 'SIGNATURE', '서명을 해 주세요.');
    file = await signatureFile(input as SigVector);
  }
  const path = `${promiseId}/${role}-${n}-${file.sha.slice(0, 12)}.json`;
  await db.putFile('signatures', path, file.body, 'application/json');
  return { path, sha: file.sha, kind: typed ? 'typed' as const : 'drawn' as const };
}
/** 이벤트에 남길 서명 방식(이름 입력일 때만) */
const sigKind = (s: { kind: 'typed' | 'drawn' }) => (s.kind === 'typed' ? { sig_kind: 'typed' } : {});

const isSoloDemo = (s: Snapshot) => s.promise.is_demo && s.parties.length === 2 && !!s.parties[0].user_id && s.parties[0].user_id === s.parties[1].user_id;

function roleOf(s: Snapshot, userId: string | null): 'A' | 'B' | null {
  if (!userId) return null;
  return (s.parties.find((p) => p.user_id === userId)?.role as 'A' | 'B') ?? null;
}

async function load(db: Db, ctx: Ctx, b: Body, need?: 'A' | 'B') {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  const id = str(b.id, 40);
  const s = await db.snapshot({ id });
  if (!s) fail(404, 'NOT_FOUND', '약속을 찾을 수 없어요.');
  let role = roleOf(s!, ctx.userId);
  if (!role) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
  // 혼자 하는 시연 약속(A·B가 같은 계정): 화면에서 고른 역할로 동작
  if (isSoloDemo(s!)) role = need ?? (b.as === 'B' ? 'B' : 'A');
  if (need && role !== need) fail(403, 'WRONG_ROLE', need === 'A' ? '작성자만 할 수 있어요.' : '상대방만 할 수 있어요.');
  const version = Number(b.version);
  if (!Number.isInteger(version)) fail(400, 'VERSION', '버전 정보가 없어요.');
  if (version !== s!.promise.version) fail(409, 'VERSION_CONFLICT', '그사이 약속이 바뀌었어요. 새로고침해 주세요.');
  return { s: s!, role: role!, doc: rowToDoc(s!.promise, s!.parties), version };
}

const expect = (doc: PromiseDoc, ...st: PromiseStatus[]) => {
  if (!st.includes(doc.status)) fail(409, 'BAD_STATUS', '지금 상태에서는 할 수 없는 동작이에요.');
};

/** 시연 모드: 약속에 저장된 되감기 일수를 적용한 "오늘" */
const todayFor = (s: Snapshot, ctx: Ctx) => {
  const off = (s.promise as unknown as { demo_offset_days?: number | null }).demo_offset_days;
  return s.promise.is_demo && off != null && s.promise.deadline ? addDays(s.promise.deadline, off) : kstToday(ctx.now);
};
const simAt = (s: Snapshot, ctx: Ctx) => (s.promise.is_demo && (s.promise as unknown as { demo_offset_days?: number | null }).demo_offset_days != null ? todayFor(s, ctx) : null);

// ------------------------------------------------------------------ 동작
/** 동작 직후 상대에게 보낼 알림 */
interface Tell { userId: string | null; promiseId: string; code: string; kind: string; title: string; body: string; respectMute?: boolean; immediate?: boolean }
type Outbox = Tell[];
/** 운영자가 이 약속의 재촉을 멈췄거나 작성자가 재촉 정지 중이면(DB 트리거가 거부) 안내로 바꾼다 */
const blockedFail = (e: unknown) => {
  if (String((e as Error)?.message).includes('NUDGE_BLOCKED')) fail(403, 'NUDGE_BLOCKED', '신고 검토 결과에 따라 이 약속에서는 재촉·촉구서를 보낼 수 없어요.');
};

const tell = (out: Outbox, s: Snapshot, to: 'A' | 'B', kind: string, title: string, body: string, respectMute = true) => {
  const u = s.parties.find((p) => p.role === to)?.user_id ?? null;
  // 시연 약속은 밤에도 바로 보낸다(시연하는 본인 기기로만 감)
  if (u) out.push({ userId: u, promiseId: s.promise.id, code: s.promise.share_code, kind, title, body, respectMute, immediate: s.promise.is_demo });
};

export async function handleAction(db: Db, ctx: Ctx, b: Body): Promise<Record<string, unknown>> {
  const out: Outbox = [];
  const result = await core(db, ctx, b, out);
  if (out.length) {
    // 알림 실패가 동작 자체를 실패시키지 않도록 분리
    try {
      const ids: number[] = [];
      for (const t of out) ids.push(...(await enqueue(db, ctx.now, { ...t, url: promiseUrl(ctx.appUrl || DEFAULT_APP_URL, t.code) })));
      if (ids.length && ctx.senders) await flush(db, ctx.senders, { ids });
    } catch (e) {
      console.error('notify', e);
    }
  }
  return result;
}

async function core(db: Db, ctx: Ctx, b: Body, out: Outbox): Promise<Record<string, unknown>> {
  const action = str(b.action, 32);
  const nowIso = ctx.now.toISOString();
  switch (action) {
    case 'create': {
      if (!ctx.userId) fail(401, 'LOGIN', '서명하려면 로그인해 주세요.');
      if (b.agree !== true) fail(400, 'AGREE', '내용 확인에 체크해 주세요.');
      const tpl = b.tpl;
      if (!isTemplateKey(tpl)) fail(400, 'TEMPLATE', '증서 종류를 골라 주세요.');
      const rep = applyRepeat(tpl as TemplateKey, cleanFields(tpl as TemplateKey, { ...((b.fields || {}) as Body), ...(b.repeat ? { amount: '1', deadline: '2000-01-01' } : {}) }), b.repeat, kstToday(ctx.now));
      const f = rep.f;
      const bEmail = cleanBEmail(b.bEmail);
      const isDemo = b.isDemo === true;
      let notice = '';
      if (tpl === 'loan' && (f.interestRate ?? 0) > 0 && !isDemo) {
        const n = await db.countInterestLoans(ctx.userId!, REPEAT_WINDOW_DAYS);
        if (n + 1 >= REPEAT_INTEREST_LOAN_THRESHOLD) notice = REPEAT_LOAN_NOTICE;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newShareCode();
        const id = crypto.randomUUID();
        const sig = await saveSignature(db, id, 'A', b.signature, 1, f.aName);
        const doc = { ...f, code, tpl: tpl as TemplateKey, installments: rep.installments, amendments: [], sigA: { at: nowIso, sha: sig.sha }, sigB: null };
        const hash = await certHashV3(doc);
        try {
          await db.create({
            promise: { id, share_code: code, template: tpl, ...fieldsToRow(f), installments: rep.installments, status: 'pending_b', current_hash: hash, canonical_version: 3, is_demo: isDemo, created_by: ctx.userId, created_at: nowIso },
            parties: [
              { role: 'A', user_id: ctx.userId, display_name: f.aName, signature_path: sig.path, signature_sha256: sig.sha, signed_at: nowIso, signer_ip: ctx.ip, signer_ua: ctx.ua, consent_at: nowIso, consent_version: CONSENT_VERSION },
              { role: 'B', user_id: null, display_name: f.bName, expected_email: bEmail },
            ],
            event: event('A', 'created', { code, hash, sig_sha: sig.sha, ...sigKind(sig), quote: str(b.quote, 300) || undefined, ip_src: ctx.ipSource, b_email_required: !!bEmail, ...(rep.rule ? { repeat: rep.rule } : {}) }),
          });
          return { id, code, hash, notice };
        } catch (e) {
          if (String((e as Error).message).includes('share_code') && attempt < 4) continue; // 코드 충돌 → 다시
          throw e;
        }
      }
      return fail(500, 'CODE', '공유 코드를 만들지 못했어요.');
    }

    case 'update': { // A가 수정 요청을 반영하거나 서명 대기 중 내용을 고쳐 다시 서명
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'pending_b', 'revise');
      if (b.agree !== true) fail(400, 'AGREE', '내용 확인에 체크해 주세요.');
      const tpl = isTemplateKey(b.tpl) ? b.tpl : doc.tpl;
      const rep = applyRepeat(tpl, cleanFields(tpl, { ...((b.fields || {}) as Body), ...(b.repeat ? { amount: '1', deadline: '2000-01-01' } : {}) }), b.repeat, todayFor(s, ctx));
      const f = rep.f;
      const bEmail = cleanBEmail(b.bEmail);
      const bLinked = !!s.parties.find((p) => p.role === 'B')?.user_id;
      const sig = await saveSignature(db, doc.id, 'A', b.signature, version + 1, f.aName);
      const hash = await certHashV3({ ...f, code: doc.code, tpl, installments: rep.installments, amendments: [], sigA: { at: nowIso, sha: sig.sha }, sigB: null });
      await db.commit({
        promise_id: doc.id, version, expect_status: ['pending_b', 'revise'],
        patch: { template: tpl, ...fieldsToRow(f), installments: rep.installments, status: 'pending_b', revise_note: null, current_hash: hash },
        parties: [
          { role: 'A', display_name: f.aName, signature_path: sig.path, signature_sha256: sig.sha, signed_at: nowIso, signer_ip: ctx.ip, signer_ua: ctx.ua },
          { role: 'B', display_name: f.bName, ...(bLinked ? {} : { expected_email: bEmail }) },
        ],
        event: event('A', 'edited', { hash, sig_sha: sig.sha, ...sigKind(sig), ...(rep.rule ? { repeat: rep.rule } : {}) }, simAt(s, ctx)),
      });
      tell(out, s, 'B', 'edited', `[키프] ${f.aName}님이 증서를 고쳐 다시 보냈어요`, `'${f.title}' 증서를 확인하고 서명해 주세요.`);
      return { id: doc.id, hash };
    }

    case 'claim': { // B가 share_code로 들어와 동의·로그인 후 연결 (Edge Function에서만 처리)
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      if (b.consent !== true) fail(400, 'CONSENT', '개인정보 수집·이용에 동의해 주세요.');
      const code = normalizeShareCode(str(b.code, 20));
      if (!SHARE_CODE_RE.test(code)) fail(400, 'CODE', '공유 코드가 올바르지 않아요.');
      const s = await db.snapshot({ code });
      if (!s) fail(404, 'NOT_FOUND', '약속을 찾을 수 없어요.');
      const A = s!.parties.find((p) => p.role === 'A')!, B = s!.parties.find((p) => p.role === 'B')!;
      if (A.user_id === ctx.userId) return { id: s!.promise.id, role: 'A' };
      if (B.user_id === ctx.userId) return { id: s!.promise.id, role: 'B' };
      if (B.user_id) fail(409, 'TAKEN', '이미 다른 계정이 상대방으로 연결된 약속이에요.');
      const want = (B as PartyRow & { expected_email?: string | null }).expected_email;
      if (want && want !== String(ctx.userEmail || '').toLowerCase()) fail(403, 'EMAIL_MISMATCH', `작성자가 지정한 이메일(${maskEmail(want)})로 로그인해야 서명할 수 있어요.`);
      if (!['pending_b', 'revise'].includes(s!.promise.status) && !s!.promise.legacy_doc) fail(409, 'BAD_STATUS', '서명을 받을 수 없는 상태의 약속이에요.');
      await db.commit({
        promise_id: s!.promise.id, version: s!.promise.version,
        parties: [{ role: 'B', user_id: ctx.userId, consent_at: nowIso, consent_version: CONSENT_VERSION, linked_hint: maskEmail(ctx.userEmail) || null }],
        event: event('B', 'joined', { consent_version: CONSENT_VERSION }, simAt(s!, ctx)),
      });
      return { id: s!.promise.id, role: 'B' };
    }

    case 'sign': {
      const { s, doc, version } = await load(db, ctx, b, 'B');
      expect(doc, 'pending_b');
      if (b.agree !== true) fail(400, 'AGREE', '내용 확인에 체크해 주세요.');
      if (b.seenHash && b.seenHash !== doc.currentHash) fail(409, 'CHANGED', '그사이 증서 내용이 바뀌었어요. 다시 확인해 주세요.');
      const sig = await saveSignature(db, doc.id, 'B', b.signature, version + 1, doc.bName);
      const hash = await certHashV3({ ...doc, sigB: { at: nowIso, sha: sig.sha } });
      await db.commit({
        promise_id: doc.id, version, expect_status: ['pending_b'],
        patch: { status: 'active', current_hash: hash },
        parties: [{ role: 'B', signature_path: sig.path, signature_sha256: sig.sha, signed_at: nowIso, signer_ip: ctx.ip, signer_ua: ctx.ua }],
        event: event('B', 'signed', { hash, sig_sha: sig.sha, ...sigKind(sig), ip_src: ctx.ipSource }, simAt(s, ctx)),
      });
      // 확정 증서의 확인코드·해시를 양쪽에 보내 각자 독립된 사본을 갖게 한다(나중에 기록이 바뀌어도 대조 가능)
      const keep = `\n\n확인코드 ${shortHash(hash)}\nSHA-256 ${hash}\n확정 시각 ${nowIso}\n\n이 메일을 보관해 두세요. 나중에 키프 '위변조 확인'에서 증서의 확인코드가 이 값과 같은지 비교할 수 있어요.`;
      tell(out, s, 'A', 'signed', `[키프] ${doc.bName}님이 서명했어요 · 증서 확정`, `'${doc.title}' 증서가 확정됐어요.${keep}`);
      tell(out, s, 'B', 'signed', `[키프] '${doc.title}' 증서가 확정됐어요`, `${doc.aName}님과의 약속에 서명을 마쳤어요.${keep}`);
      return { id: doc.id, hash };
    }

    case 'revise': {
      const { s, doc, version } = await load(db, ctx, b, 'B');
      expect(doc, 'pending_b');
      const note = str(b.note, 500);
      if (!note) fail(400, 'NOTE', '고칠 부분을 적어 주세요.');
      await db.commit({ promise_id: doc.id, version, expect_status: ['pending_b'], patch: { status: 'revise', revise_note: note }, event: event('B', 'revise_requested', { note }, simAt(s, ctx)) });
      tell(out, s, 'A', 'revise', `[키프] ${doc.bName}님이 수정을 요청했어요`, `'${doc.title}': ${note}`);
      return { id: doc.id };
    }

    case 'decline': {
      const { s, doc, version } = await load(db, ctx, b, 'B');
      expect(doc, 'pending_b', 'revise');
      const note = str(b.note, 300);
      await db.commit({ promise_id: doc.id, version, expect_status: ['pending_b', 'revise'], patch: { status: 'declined' }, event: event('B', 'declined', { note }, simAt(s, ctx)) });
      tell(out, s, 'A', 'declined', `[키프] ${doc.bName}님이 서명을 거절했어요`, `'${doc.title}'${note ? ': ' + note : ''}`);
      return { id: doc.id };
    }

    case 'cancel': {
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'pending_b', 'revise');
      await db.commit({ promise_id: doc.id, version, expect_status: ['pending_b', 'revise'], patch: { status: 'cancelled' }, event: event('A', 'cancelled', { note: str(b.note, 300) }, simAt(s, ctx)) });
      tell(out, s, 'B', 'cancelled', `[키프] ${doc.aName}님이 서명 요청을 취소했어요`, `'${doc.title}'`);
      return { id: doc.id };
    }

    case 'request': {
      const { s, doc, version } = await load(db, ctx, b, 'B');
      expect(doc, 'active');
      if (s.requests.some((r) => r.status === 'pending')) fail(409, 'PENDING', '이미 답을 기다리는 요청이 있어요.');
      const note = str(b.note, 300);
      const today = todayFor(s, ctx);
      let ins: Record<string, unknown>;
      if (b.kind === 'extend') {
        const nd = str(b.newDeadline, 10);
        if (!isYmd(nd) || diffDays(nd, doc.deadline) <= 0) fail(400, 'DATE', '지금 기한보다 뒤 날짜를 골라 주세요.');
        ins = { kind: 'extend', new_deadline: nd, note };
      } else if (b.kind === 'split') {
        if (TPL[doc.tpl].kind !== 'money' || !doc.amount) fail(400, 'SPLIT', '금액 약속만 나눠서 이행할 수 있어요.');
        const parts = Math.min(4, Math.max(2, Number(b.parts) || 2));
        const every = [7, 14, 30].includes(Number(b.every)) ? Number(b.every) : 14;
        ins = { kind: 'split', installments: splitPlan(doc.amount!, parts, every, doc.deadline, today), note };
      } else return fail(400, 'KIND', '요청 종류를 골라 주세요.');
      await db.commit({ promise_id: doc.id, version, expect_status: ['active'], request_insert: ins, event: event('B', 'request_made', { ...ins }, simAt(s, ctx)) });
      tell(out, s, 'A', 'request', `[키프] ${doc.bName}님이 ${b.kind === 'extend' ? '기한 연장' : '나눠서 이행'}을 요청했어요`, `'${doc.title}'${note ? ' · 사유: ' + note : ''}\n키프에서 수락하거나 거절해 주세요.`);
      return { id: doc.id };
    }

    case 'answer': {
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'active', 'reported');
      const r = s.requests.find((x) => x.id === b.requestId && x.status === 'pending');
      if (!r) fail(404, 'REQUEST', '대기 중인 요청이 없어요.');
      if (b.ok !== true) {
        const note = str(b.note, 300);
        await db.commit({ promise_id: doc.id, version, request_update: { id: r!.id, status: 'declined' }, event: event('A', 'request_answered', { ok: false, request_id: r!.id, note }, simAt(s, ctx)) });
        tell(out, s, 'B', 'answer', `[키프] ${doc.aName}님이 요청을 거절했어요`, `'${doc.title}' 기존 기한(${korDate(doc.deadline)})이 유지돼요.${note ? ' · ' + note : ''}`);
        return { id: doc.id };
      }
      let text: string;
      const next = { ...doc };
      if (r!.kind === 'extend') {
        next.deadline = r!.new_deadline!;
        text = `기한을 ${korDate(doc.deadline)}에서 ${korDate(next.deadline)}로 연장 (상대 요청, 작성자 수락)`;
      } else {
        next.installments = (r!.installments || []).map((x) => ({ amount: Number(x.amount), date: x.date, paid: false }));
        next.deadline = next.installments[next.installments.length - 1].date;
        text = `${next.installments.length}회 나눠서 이행으로 변경, 마지막 ${korDate(next.deadline)} (상대 요청, 작성자 수락)`;
      }
      next.amendments = [...doc.amendments, { at: nowIso, text }];
      const hash = await certHashV3(next);
      await db.commit({
        promise_id: doc.id, version,
        patch: { deadline: next.deadline, installments: next.installments, amendments: next.amendments, current_hash: hash, canonical_version: 3, deadline_version: doc.deadlineVersion + 1 },
        request_update: { id: r!.id, status: 'accepted' },
        event: event('A', 'request_answered', { ok: true, request_id: r!.id, text, hash }, simAt(s, ctx)),
      });
      tell(out, s, 'B', 'answer', `[키프] ${doc.aName}님이 요청을 수락했어요`, `'${doc.title}' ${text}`);
      return { id: doc.id, hash };
    }

    case 'report': {
      const { s, doc, version } = await load(db, ctx, b, 'B');
      expect(doc, 'active');
      const nextIdx = doc.installments.findIndex((x) => !x.paid);
      const expectAmt = nextIdx >= 0 ? doc.installments[nextIdx].amount : doc.amount;
      const amount = TPL[doc.tpl].kind === 'money' ? intOrNull(b.amount) : null;
      const paidOn = amount ? (isYmd(b.paidOn) ? String(b.paidOn) : todayFor(s, ctx)) : null;
      const note = str(b.note, 300);
      // 송금 완료 캡처(선택): 비공개 evidence 버킷에 저장, AI가 읽은 값은 참고용으로만 기록(최종 확인은 A)
      let proofPath: string | null = null;
      let aiReading: Record<string, unknown> | null = null;
      if (b.proof && typeof b.proof === 'object') {
        const pr = b.proof as { mediaType?: string; data?: string };
        if (!IMAGE_MIMES.includes(pr.mediaType as ImageMime) || typeof pr.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(pr.data) || pr.data.length > 4_200_000) fail(400, 'IMAGE', '캡처 이미지가 너무 크거나 손상됐어요.');
        const bytes = Uint8Array.from(atob(pr.data!), (c) => c.charCodeAt(0));
        const ext = pr.mediaType === 'image/png' ? 'png' : pr.mediaType === 'image/webp' ? 'webp' : 'jpg';
        proofPath = `${doc.id}/proof-${crypto.randomUUID()}.${ext}`;
        await db.putBinary('evidence', proofPath, bytes, pr.mediaType!);
        const r = validateProof(b.aiReading);
        aiReading = r ? { ...r, by: 'ai', attached: true } : { attached: true };
      }
      const payload = { amount, paid_on: paidOn, installment_no: nextIdx >= 0 ? nextIdx : null, note, match: amount ? amount === expectAmt : null, proof: !!proofPath };
      await db.commit({
        promise_id: doc.id, version, expect_status: ['active'], patch: { status: 'reported' },
        payment_insert: { amount, paid_on: paidOn, installment_no: payload.installment_no, note, proof_path: proofPath, ai_reading: aiReading },
        event: event('B', 'reported', payload, simAt(s, ctx)),
      });
      tell(out, s, 'A', 'report', `[키프] ${doc.bName}님이 약속을 지켰다고 알렸어요`, `'${doc.title}'${amount ? ` · 보낸 금액 ${amount.toLocaleString('ko-KR')}원` : ''}${note ? ' · ' + note : ''}\n실제로 받았는지 확인하고 완료 처리해 주세요.`);
      return { id: doc.id };
    }

    case 'confirm': {
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'active', 'reported');
      const pending = s.payments.find((x) => x.confirmed_by_a === null);
      const installments = doc.installments.map((x) => ({ ...x }));
      const today = todayFor(s, ctx);
      let done: boolean, payload: Record<string, unknown>;
      const commit: Record<string, unknown> = { promise_id: doc.id, version, expect_status: ['active', 'reported'] };
      if (TPL[doc.tpl].kind === 'money' && doc.amount) {
        // 상환 장부: 확인된 금액을 더해 남은 금액이 0이 되면 완료, 아니면 부분 상환으로 진행 중 유지
        const before = s.payments.filter((x) => x.confirmed_by_a === true).reduce((n, x) => n + (Number(x.amount) || 0), 0);
        const left = Math.max(0, doc.amount - before);
        const nextInst = installments.find((x) => !x.paid);
        const thisAmt = pending ? (Number(pending.amount) || (nextInst ? nextInst.amount : left)) : left; // 신고 없이 '완료로 처리'는 남은 금액 전부
        const paidTotal = before + thisAmt;
        let acc = paidTotal;
        for (const it of installments) { if (acc >= it.amount) { it.paid = true; acc -= it.amount; } else { it.paid = false; acc = 0; } }
        done = paidTotal >= doc.amount;
        payload = { amount: thisAmt, paid_total: Math.min(paidTotal, doc.amount), remaining: Math.max(0, doc.amount - paidTotal) };
        if (pending) commit.payment_update = { id: pending.id, confirmed_by_a: true };
        else commit.payment_insert = { amount: thisAmt, paid_on: today, note: '작성자가 직접 받았다고 확인', confirmed_by_a: true };
      } else {
        const idx = pending && pending.installment_no != null ? pending.installment_no : installments.findIndex((x) => !x.paid);
        if (installments.length && idx >= 0 && installments[idx]) installments[idx].paid = true;
        done = !installments.some((x) => !x.paid);
        payload = { installment_no: idx };
        if (pending) commit.payment_update = { id: pending.id, confirmed_by_a: true };
      }
      commit.patch = done ? { status: 'done', installments, done_at: nowIso } : { status: 'active', installments };
      commit.event = done
        ? event('A', 'done', { early_days: isYmd(doc.deadline) ? -diffDays(today, doc.deadline) : null, ...('paid_total' in payload ? { paid_total: payload.paid_total } : {}) }, simAt(s, ctx))
        : event('A', 'confirmed', payload, simAt(s, ctx));
      await db.commit(commit);
      const rem = Number(payload.remaining) || 0;
      tell(out, s, 'B', 'confirm', done ? `[키프] 약속 지킴 완료!` : `[키프] 상환이 확인됐어요`, done ? `${doc.aName}님이 '${doc.title}' 이행을 확인했어요. 지켜줘서 고마워요.` : `'${doc.title}' ${payload.amount ? `${Number(payload.amount).toLocaleString('ko-KR')}원 확인 · 남은 금액 ${rem.toLocaleString('ko-KR')}원` : '이번 회차가 확인됐어요'}. 남은 것도 기한에 맞춰 부탁해요.`);
      return { id: doc.id, done, remaining: rem };
    }

    case 'record_payment': { // A가 직접 받은 금액을 장부에 기록(부분 상환)
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'active');
      if (TPL[doc.tpl].kind !== 'money' || !doc.amount) fail(400, 'NOT_MONEY', '금액 약속에서만 상환을 기록할 수 있어요.');
      const before = s.payments.filter((x) => x.confirmed_by_a === true).reduce((n, x) => n + (Number(x.amount) || 0), 0);
      const left = doc.amount! - before;
      const amount = intOrNull(b.amount);
      if (!amount) fail(400, 'AMOUNT', '받은 금액을 적어 주세요.');
      if (amount! > left) fail(400, 'AMOUNT', `남은 금액(${left.toLocaleString('ko-KR')}원)보다 많아요.`);
      const paidOn = isYmd(b.paidOn) ? String(b.paidOn) : todayFor(s, ctx);
      const paidTotal = before + amount!;
      const installments = doc.installments.map((x) => ({ ...x }));
      let acc = paidTotal;
      for (const it of installments) { if (acc >= it.amount) { it.paid = true; acc -= it.amount; } else { it.paid = false; acc = 0; } }
      const done = paidTotal >= doc.amount!;
      const note = str(b.note, 300);
      await db.commit({
        promise_id: doc.id, version, expect_status: ['active'],
        patch: done ? { status: 'done', installments, done_at: nowIso } : { installments },
        payment_insert: { amount, paid_on: paidOn, note: note || '작성자가 직접 기록', confirmed_by_a: true },
        event: done
          ? event('A', 'done', { early_days: isYmd(doc.deadline) ? -diffDays(todayFor(s, ctx), doc.deadline) : null, paid_total: doc.amount })
          : event('A', 'confirmed', { amount, paid_total: paidTotal, remaining: doc.amount! - paidTotal, recorded: true }, simAt(s, ctx)),
      });
      tell(out, s, 'B', 'confirm', done ? '[키프] 약속 지킴 완료!' : '[키프] 상환이 기록됐어요', `'${doc.title}' ${amount!.toLocaleString('ko-KR')}원을 받았다고 ${doc.aName}님이 기록했어요.${done ? '' : ` 남은 금액 ${(doc.amount! - paidTotal).toLocaleString('ko-KR')}원.`}`);
      return { id: doc.id, done, remaining: doc.amount! - paidTotal };
    }

    case 'reject': {
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'reported');
      const pending = s.payments.find((x) => x.confirmed_by_a === null);
      const note = str(b.note, 300);
      await db.commit({
        promise_id: doc.id, version, expect_status: ['reported'], patch: { status: 'active' },
        ...(pending ? { payment_update: { id: pending.id, confirmed_by_a: false } } : {}),
        event: event('A', 'report_rejected', { note }, simAt(s, ctx)),
      });
      tell(out, s, 'B', 'reject', `[키프] 아직 확인이 안 됐어요`, `${doc.aName}님이 '${doc.title}' 이행을 아직 확인하지 못했어요.${note ? ' · ' + note : ''} 한 번 더 확인해 주세요.`);
      return { id: doc.id };
    }

    case 'signatures': { // 당사자에게 서명 벡터 제공 (Storage는 서버만 접근)
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      const out: Record<string, unknown> = {};
      for (const p of s!.parties) {
        if (!p.signature_path) { out[p.role] = null; continue; }
        const body = await db.getFile('signatures', p.signature_path);
        out[p.role] = body ? JSON.parse(body) : null;
      }
      return out;
    }

    case 'evidence': { // 증거 묶음용 서명 메타데이터(IP·UA 포함) — 당사자만
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      return { parties: s!.parties.map((p) => ({ role: p.role, display_name: p.display_name, signed_at: p.signed_at, signer_ip: p.signer_ip, signer_ua: p.signer_ua, consent_at: p.consent_at, signature_sha256: p.signature_sha256 })) };
    }

    case 'nudge_send': { // A가 확인한 재촉 메시지를 B에게 (D+3, D+7)
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'active');
      const stage = Number(b.stage);
      const now = promiseStage(doc, todayFor(s, ctx));
      if (stage !== now || (stage !== 3 && stage !== 4)) fail(409, 'STAGE', '지금은 이 단계의 재촉을 보낼 수 없어요.');
      const text = str(b.text, 1000);
      if (!text) fail(400, 'TEXT', '보낼 메시지를 적어 주세요.');
      const bad = checkBanned(text);
      if (bad) fail(400, 'BANNED', `${bad}으로 보일 수 있는 표현이 있어요. 표현을 바꿔 주세요.`);
      const tone = Math.min(5, Math.max(1, Number(b.tone) || 2)), rel = str(b.rel, 10);
      await db.commit({
        promise_id: doc.id, version, expect_status: ['active'],
        nudge_send: { stage, message: text, tone, relation: rel, ai_used: b.aiUsed === true },
        event: event('A', 'nudge_sent', { stage, text, tone, rel }, simAt(s, ctx)),
      }).catch((e) => { blockedFail(e); if (String(e.message).includes('NUDGE_ALREADY_SENT')) fail(409, 'ALREADY_SENT', '이 단계 재촉은 이미 보냈어요.'); throw e; });
      tell(out, s, 'B', `nudge_${stage}`, `[키프] ${doc.aName}님의 메시지`, `${text}\n\n('${doc.title}' 약속 · 기한이 어렵다면 키프에서 연장·분할을 요청할 수 있어요)`);
      return { id: doc.id, stage };
    }

    case 'notice_send': { // 공식 통지(이행 촉구서) (D+14)
      const { s, doc, version } = await load(db, ctx, b, 'A');
      expect(doc, 'active');
      if (promiseStage(doc, todayFor(s, ctx)) !== 5) fail(409, 'STAGE', '이행 촉구서는 기한 14일 뒤부터 보낼 수 있어요.');
      const text = str(b.text, 4000);
      if (text.length < 50) fail(400, 'TEXT', '촉구서 내용이 너무 짧아요.');
      const bad = checkBanned(text);
      if (bad) fail(400, 'BANNED', `${bad}으로 보일 수 있는 표현이 있어요. 표현을 바꿔 주세요.`);
      if (!text.includes('법률 자문이 아닙니다')) fail(400, 'DISCLAIMER', "'법률 자문이 아닙니다' 문구는 지울 수 없어요.");
      await db.commit({
        promise_id: doc.id, version, expect_status: ['active'],
        nudge_send: { stage: 5, message: text, tone: 5, relation: '', ai_used: b.aiUsed === true },
        event: event('A', 'notice_sent', { stage: 5, text }, simAt(s, ctx)),
      }).catch((e) => { blockedFail(e); if (String(e.message).includes('NUDGE_ALREADY_SENT')) fail(409, 'ALREADY_SENT', '이행 촉구서는 이미 보냈어요.'); throw e; });
      tell(out, s, 'B', 'notice', `[키프] ${doc.aName}님이 이행 촉구서를 보냈어요`, text);
      return { id: doc.id };
    }

    case 'pay_info': { // 상대방(B)에게 작성자의 송금 링크(토스 아이디·카카오페이)를 알려 줌 — 당사자만
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      if (TPL[s!.promise.template].kind !== 'money') return { toss: null, kakao: null };
      const l = await db.payLinks(s!.promise.id);
      return { toss: l.toss || null, kakao: l.kakao || null };
    }

    case 'proof_url': { // 송금 캡처 보기(당사자만, 5분짜리 주소)
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      const pay = s!.payments.find((p) => p.id === b.paymentId);
      if (!pay?.proof_path) fail(404, 'NO_PROOF', '첨부한 캡처가 없어요.');
      return { url: await db.signedUrl('evidence', pay!.proof_path!, 300) };
    }

    case 'abuse_report': { // 받은 쪽(주로 B)의 신고 → 기록 + 이 약속 알림 끄기
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      const reason = str(b.reason, 500);
      if (!reason) fail(400, 'REASON', '신고 사유를 적어 주세요.');
      await db.abuseReport(s!.promise.id, ctx.userId!, reason);
      return { ok: true, subject: subjectText(rowToDoc(s!.promise, s!.parties)) };
    }

    case 'group_create': { // 여러 명 정산: 총액·멤버로 멤버별 경비 정산 확인서를 한 번에(서명 한 번)
      if (!ctx.userId) fail(401, 'LOGIN', '서명하려면 로그인해 주세요.');
      if (b.agree !== true) fail(400, 'AGREE', '내용 확인에 체크해 주세요.');
      const total = intOrNull(b.total);
      if (!total) fail(400, 'TOTAL', '총액을 적어 주세요.');
      const names = (Array.isArray(b.members) ? b.members : []).map((m) => str(m, 40)).filter(Boolean);
      if (names.length < 1 || names.length > 20) fail(400, 'MEMBERS', '정산할 사람을 1~20명 적어 주세요.');
      if (new Set(names).size !== names.length) fail(400, 'MEMBERS', '같은 이름이 두 번 있어요. 구분할 수 있게 적어 주세요.');
      const includeSelf = b.includeSelf !== false;
      const { each } = splitShares(total!, names.length, includeSelf);
      if (each.some((x) => x <= 0)) fail(400, 'TOTAL', '총액이 너무 작아요.');
      const base = (b.fields || {}) as Body;
      const groupId = crypto.randomUUID();
      const nowIso2 = nowIso;
      const made: { name: string; amount: number; code: string; id: string }[] = [];
      for (let i = 0; i < names.length; i++) {
        const f = cleanFields('split', { ...base, bName: names[i], amount: String(each[i]), title: `${str(base.title, 50) || '경비 정산'} · ${names[i]}` });
        const id = crypto.randomUUID(), code = newShareCode();
        const sig = await saveSignature(db, id, 'A', b.signature, 1, f.aName);
        const hash = await certHashV3({ ...f, code, tpl: 'split', installments: [], amendments: [], sigA: { at: nowIso2, sha: sig.sha }, sigB: null });
        await db.create({
          promise: { id, share_code: code, template: 'split', ...fieldsToRow(f), status: 'pending_b', current_hash: hash, canonical_version: 3, group_id: groupId, created_by: ctx.userId, created_at: nowIso2 },
          parties: [
            { role: 'A', user_id: ctx.userId, display_name: f.aName, signature_path: sig.path, signature_sha256: sig.sha, signed_at: nowIso2, signer_ip: ctx.ip, signer_ua: ctx.ua, consent_at: nowIso2, consent_version: CONSENT_VERSION },
            { role: 'B', user_id: null, display_name: f.bName },
          ],
          event: event('A', 'created', { code, hash, sig_sha: sig.sha, ...sigKind(sig), group: groupId, total, members: names.length, include_self: includeSelf }),
        });
        made.push({ name: names[i], amount: each[i], code, id });
      }
      return { groupId, made };
    }

    case 'demo_create': { // 시연 약속: 예시 대화로 바로 만들고 혼자 A·B 서명까지(진행 중 상태)
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const ex = EXAMPLES.find((e) => e.key === b.example) || EXAMPLES[0];
      const today = kstToday(ctx.now);
      const r = ruleExtract({ raw: ex.text, tpl: ex.tpl, myName: ex.myName }, today);
      const kind = TPL[ex.tpl].kind;
      const f = cleanFields(ex.tpl, {
        title: '[시연] ' + (r.title || ex.label), aName: ex.myName, bName: r.bName || '상대방',
        amount: kind === 'money' ? String(r.amount || 300000) : '', item: r.item || '노트북', task: r.task || '발표 자료 만들기',
        deadline: r.deadline || addDays(today, 3), method: r.method || '', penalty: r.penalty || '',
      });
      const id = crypto.randomUUID(), code = newShareCode(), nowIso = ctx.now.toISOString();
      const sa = await saveSignature(db, id, 'A', DEMO_SIG, 1), sb = await saveSignature(db, id, 'B', DEMO_SIG, 1);
      const hash = await certHashV3({ ...f, code, tpl: ex.tpl, installments: [], amendments: [], sigA: { at: nowIso, sha: sa.sha }, sigB: { at: nowIso, sha: sb.sha } });
      const party = (role: 'A' | 'B', name: string, sig: { path: string; sha: string }) => ({ role, user_id: ctx.userId, display_name: name, signature_path: sig.path, signature_sha256: sig.sha, signed_at: nowIso, signer_ip: ctx.ip, signer_ua: ctx.ua, consent_at: nowIso, consent_version: CONSENT_VERSION });
      await db.create({
        promise: { id, share_code: code, template: ex.tpl, ...fieldsToRow(f), status: 'active', current_hash: hash, canonical_version: 3, is_demo: true, created_by: ctx.userId, created_at: nowIso },
        parties: [party('A', f.aName, sa), party('B', f.bName, sb)],
        event: event('A', 'created', { code, hash, sig_sha: sa.sha, demo: true, quote: r.quote || undefined }),
      });
      return { id, code };
    }

    case 'demo_offset': { // 시연 날짜 되감기 (시연 약속만)
      const { s, doc, version } = await load(db, ctx, b);
      if (!s.promise.is_demo) fail(403, 'NOT_DEMO', '시연 약속에서만 날짜를 바꿀 수 있어요.');
      const offset = b.offset === null ? null : Number(b.offset);
      if (offset !== null && ![-3, 0, 3, 7, 14].includes(offset)) fail(400, 'OFFSET', '날짜를 다시 골라 주세요.');
      await db.commit({ promise_id: doc.id, version, patch: { demo_offset_days: offset }, event: event('system', 'demo_time', { offset }, offset === null ? null : addDays(doc.deadline, offset)) });
      return { id: doc.id, today: offset === null ? kstToday(ctx.now) : addDays(doc.deadline, offset) };
    }

    case 'demo_cron': { // 오전 9시 점검을 이 시연 약속에 대해 지금 실행 → 실제 기기·이메일로 발송
      if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
      const s = await db.snapshot({ id: str(b.id, 40) });
      if (!s || !roleOf(s, ctx.userId)) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
      if (!s!.promise.is_demo) fail(403, 'NOT_DEMO', '시연 약속에서만 바로 실행할 수 있어요.');
      const r = await runDaily(db, ctx.now, { promiseId: s!.promise.id, immediate: true, appUrl: ctx.appUrl });
      const sent = r.queued.length && ctx.senders ? await flush(db, ctx.senders, { ids: r.queued }) : { claimed: 0, sent: 0, failed: 0 };
      const result = r.log.length ? r.log.map((l) => l.replace(/^\w+: /, '')).join(', ') : '이 날짜에 보낼 알림이 없거나 이미 보냈어요';
      await db.systemEvent(s!.promise.id, 'demo_cron', jcs({ result }), simAt(s!, ctx));
      return { result, queued: r.queued.length, sent: sent.sent, failed: sent.failed };
    }

    case 'import': return importLegacy(db, ctx, b);

    default:
      return fail(400, 'ACTION', '알 수 없는 동작이에요.');
  }
}

// ------------------------------------------------------------------ 공개 미리보기 (로그인 전 B)
const FUNNEL_STEPS = ['view', 'otp', 'login'] as const;
type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** 미리보기(=view 기록). step을 주면 미리보기 대신 그 단계만 기록한다(otp·login) */
export async function publicPreview(db: Db, ctx: Ctx, codeIn: string, step?: unknown) {
  if (!(await db.rateCheck('preview:' + ctx.ip, 30, 60))) fail(429, 'RATE', '잠시 후 다시 시도해 주세요.');
  const code = normalizeShareCode(codeIn);
  if (!SHARE_CODE_RE.test(code)) fail(400, 'CODE', '공유 코드가 올바르지 않아요.');
  const s = await db.snapshot({ code });
  if (!s) fail(404, 'NOT_FOUND', '약속을 찾을 수 없어요. 링크를 다시 확인해 주세요.');
  const d = rowToDoc(s!.promise, s!.parties);
  const B = s!.parties.find((p) => p.role === 'B')!;
  // 퍼널: 서명을 받을 수 있는 상태이고, 보는 사람이 작성자가 아닐 때만(시연 제외). 실패해도 미리보기는 계속
  const track = (st: FunnelStep) => {
    const isA = !!ctx.userId && s!.parties.some((p) => p.role === 'A' && p.user_id === ctx.userId);
    if ((d.status === 'pending_b' || d.status === 'revise') && !isA && !s!.promise.is_demo) return db.funnelMark(s!.promise.id, st).catch((e) => console.error('funnel', e));
  };
  if (step !== undefined) {
    if (!FUNNEL_STEPS.includes(step as FunnelStep) || step === 'view') fail(400, 'STEP', '알 수 없는 단계예요.');
    await track(step as FunnelStep);
    return { ok: true };
  }
  await track('view');
  // 증서 본문만. 이름 가림, 계좌·메모·이벤트·서명 이미지 없음
  return {
    code: d.code, tpl: d.tpl, title: d.title, status: d.status,
    aName: maskName(d.aName), bName: maskName(d.bName),
    amount: d.amount, interestRate: d.interestRate, lateInterestRate: d.lateInterestRate,
    item: d.item, task: d.task, deadline: d.deadline, method: d.method, penalty: d.penalty,
    hasAccount: !!d.repayAccount, hasMemo: !!d.memo,
    signedA: !!d.sigA, signedB: !!d.sigB, bLinked: !!B.user_id, createdAt: d.createdAt,
    bEmailHint: maskEmail((B as PartyRow & { expected_email?: string | null }).expected_email) || null,
  };
}

// ------------------------------------------------------------------ 기존(이 기기 저장) 데이터 가져오기
async function importLegacy(db: Db, ctx: Ctx, b: Body) {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  const lp = b.legacy as LegacyPromise & { hash?: string; myRole?: string; status?: string; createdAt?: number; events?: { at: number; text: string }[]; sigA?: { sv?: SigVector; at: number; name: string } | null; sigB?: { sv?: SigVector; at: number; name: string } | null };
  if (!lp || typeof lp !== 'object' || !isTemplateKey(lp.tpl) || typeof lp.id !== 'string') fail(400, 'LEGACY', '키프 백업 데이터가 아니에요.');
  const tpl = lp.tpl as TemplateKey;
  let f: CleanFields;
  try {
    f = cleanFields(tpl, { ...lp, amount: lp.amount ?? '', interestRate: '', lateInterestRate: '' } as unknown as Body);
  } catch {
    return fail(400, 'LEGACY_INCOMPLETE', '내용이 비어 있는 약속은 가져올 수 없어요.');
  }
  // 양쪽 서명이 있으면 기존 확인코드를 다시 계산해 일치할 때만 '확인됨'으로 표시
  const legacyHash = typeof lp.hash === 'string' ? lp.hash : '';
  const recomputed = lp.sigA && lp.sigB ? await sha256Hex(canonicalV2(lp)) : '';
  const verified = !!legacyHash && recomputed === legacyHash;
  const myRole = lp.myRole === 'B' ? 'B' : 'A';
  const statusMap: Record<string, PromiseStatus> = { pending_b: 'pending_b', revise: 'revise', active: 'active', reported: 'active', done: 'done' };
  const status = statusMap[String(lp.status)] || 'active';
  const id = crypto.randomUUID();
  const code = newShareCode();
  const nowIso = ctx.now.toISOString();
  const party = async (role: 'A' | 'B', s: { sv?: SigVector; at: number; name: string } | null | undefined, name: string) => {
    const base: Record<string, unknown> = { role, display_name: name, user_id: role === myRole ? ctx.userId : null, consent_at: role === myRole ? nowIso : null, consent_version: role === myRole ? CONSENT_VERSION : null };
    if (s && validateVector(s.sv)) {
      const sig = await saveSignature(db, id, role, s.sv, 1);
      Object.assign(base, { signature_path: sig.path, signature_sha256: sig.sha, signed_at: new Date(s.at).toISOString() });
    }
    return base;
  };
  const events = (lp.events || []).slice(0, 100).map((e) => ({ at: new Date(e.at).toISOString(), text: String(e.text).slice(0, 200) }));
  try {
    await db.create({
      promise: {
        id, share_code: code, template: tpl, ...fieldsToRow(f), status,
        installments: (lp.installments || []).map((x) => ({ amount: Number(x.amount), date: x.date, paid: !!x.paid })),
        amendments: (lp.amendments || []).map((x) => ({ at: new Date(x.at).toISOString(), text: x.text })),
        current_hash: verified ? legacyHash : null, canonical_version: 2, legacy_doc: lp, created_by: ctx.userId,
        created_at: lp.createdAt ? new Date(lp.createdAt).toISOString() : nowIso,
        done_at: status === 'done' ? nowIso : null,
      },
      parties: [await party('A', lp.sigA, f.aName), await party('B', lp.sigB, f.bName)],
      event: event('system', 'imported', { legacy_id: lp.id, legacy_hash: legacyHash || null, verified, legacy_events: events }),
    });
  } catch (e) {
    if (String((e as Error).message).includes('promises_legacy_once')) fail(409, 'ALREADY', '이미 가져온 약속이에요.');
    throw e;
  }
  return { id, code, verified };
}
