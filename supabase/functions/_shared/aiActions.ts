// AI 요청 처리 (런타임 무관). 당사자 확인 → 한도 → Claude → 검증. 스트리밍 촉구서는 Edge Function에서 직접.
import { ActionError, type Ctx, type Db, type Snapshot } from './actions.ts';
import { aiExtract, aiNudge, aiProof, IMAGE_MIMES, noticeFacts, type AiEnv, type ImageMime } from './ai.ts';
import { rowToDoc } from './domain/mapping.ts';
import { addDays, kstToday } from './domain/dates.ts';
import { promiseStage } from './domain/progress.ts';

const fail = (status: number, code: string, message: string): never => { throw new ActionError(status, code, message); };
type Body = Record<string, unknown>;

/** base64 이미지 검사 (약 3MB 이하, jpeg·png·webp) */
export function cleanImage(v: unknown): { mediaType: ImageMime; data: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { mediaType?: string; data?: string };
  if (!IMAGE_MIMES.includes(o.mediaType as ImageMime)) fail(400, 'IMAGE', 'JPG·PNG·WEBP 이미지만 올릴 수 있어요.');
  if (typeof o.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(o.data) || o.data.length > 4_200_000) fail(400, 'IMAGE', '이미지가 너무 크거나 손상됐어요.');
  return { mediaType: o.mediaType as ImageMime, data: o.data! };
}

export const todayOfSnap = (s: Snapshot, now: Date) => {
  const off = (s.promise as unknown as { demo_offset_days?: number | null }).demo_offset_days;
  return s.promise.is_demo && off != null && s.promise.deadline ? addDays(s.promise.deadline, off) : kstToday(now);
};

async function partySnap(db: Db, ctx: Ctx, id: unknown, need?: 'A' | 'B') {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  const s = await db.snapshot({ id: String(id || '').slice(0, 40) });
  const role = s?.parties.find((p) => p.user_id === ctx.userId)?.role;
  if (!s || !role) fail(403, 'NOT_PARTY', '이 약속의 당사자가 아니에요.');
  if (need && role !== need) fail(403, 'WRONG_ROLE', need === 'A' ? '작성자만 할 수 있어요.' : '상대방만 할 수 있어요.');
  return { s: s!, role: role as 'A' | 'B', doc: rowToDoc(s!.promise, s!.parties) };
}

/** 이번 회차 약속 금액과 아직 확인되지 않은 남은 금액 */
export function expectedAndRemaining(s: Snapshot) {
  const doc = rowToDoc(s.promise, s.parties);
  if (!doc.amount) return { expected: null, remaining: null };
  const next = doc.installments.find((x) => !x.paid);
  const paid = s.payments.filter((p) => p.confirmed_by_a === true).reduce((n, p) => n + (Number(p.amount) || 0), 0);
  return { expected: next ? next.amount : doc.amount, remaining: Math.max(0, doc.amount - paid) };
}

export async function handleAi(db: Db, ctx: Ctx, env: AiEnv, b: Body) {
  if (!ctx.userId) fail(401, 'LOGIN', '로그인이 필요해요.');
  switch (b.action) {
    case 'extract': {
      const text = typeof b.text === 'string' ? b.text : '';
      const image = cleanImage(b.image);
      if (!image && text.trim().length < 5) fail(400, 'INPUT', '대화 내용이나 캡처를 넣어 주세요.');
      return aiExtract(env, ctx.userId!, ctx.now, { text, image, myName: String(b.myName || '').slice(0, 40), tpl: String(b.tpl || '') });
    }
    case 'nudge': {
      const { s, doc } = await partySnap(db, ctx, b.id, 'A');
      const today = todayOfSnap(s, ctx.now);
      const stage = promiseStage(doc, today);
      if (stage !== 3 && stage !== 4) fail(409, 'STAGE', '지금은 재촉 문구를 만들 단계가 아니에요.');
      const previous = (s.nudges || []).filter((n) => n.status === 'sent' && n.message).map((n) => String(n.message));
      return aiNudge(env, ctx.userId!, { doc, stage: stage as 3 | 4, rel: String(b.rel || '친구').slice(0, 10), tone: Math.min(5, Math.max(1, Number(b.tone) || 2)), previous, today });
    }
    case 'proof': {
      const { s } = await partySnap(db, ctx, b.id);
      const image = cleanImage(b.image);
      if (!image) fail(400, 'IMAGE', '송금 완료 화면 캡처를 올려 주세요.');
      const { expected, remaining } = expectedAndRemaining(s);
      return aiProof(env, ctx.userId!, ctx.now, image!, expected, remaining);
    }
    default:
      return fail(400, 'ACTION', '알 수 없는 AI 요청이에요.');
  }
}

/** 촉구서 초안 입력(사실 정리). Edge Function이 스트리밍에 쓴다 */
export async function noticeInput(db: Db, ctx: Ctx, id: unknown) {
  const { s, doc } = await partySnap(db, ctx, id, 'A');
  const today = todayOfSnap(s, ctx.now);
  if (promiseStage(doc, today) !== 5) fail(409, 'STAGE', '이행 촉구서는 기한 14일 뒤부터 쓸 수 있어요.');
  const B = s.parties.find((p) => p.role === 'B');
  const nudges = (s.nudges || []).filter((n) => n.status === 'sent' && n.stage < 5 && n.deadline_version === doc.deadlineVersion)
    .map((n) => ({ stage: n.stage, at: String(n.sent_at || n.created_at), text: String(n.message || '') }));
  return noticeFacts({ ...doc, bSignedAt: B?.signed_at ? new Date(B.signed_at).toISOString() : undefined }, nudges, today);
}
