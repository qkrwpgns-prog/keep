// 확인코드(SHA-256)와 정규화.
// - v3: 새 증서. RFC 8785(JCS) 방식으로 키를 정렬한 JSON의 SHA-256.
// - v2: 기존(legacy) 증서 검사·가져오기용. legacy/index.html의 canonical()과 바이트 단위로 같아야 한다.

import type { PromiseDoc } from './types.ts';

/** RFC 8785 JSON Canonicalization (키 UTF-16 정렬, 공백 없음). 정수·문자열·불리언·null·배열·객체만 사용한다. */
export function jcs(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('jcs: 유한하지 않은 숫자');
    return JSON.stringify(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => jcs(x === undefined ? null : x)).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + jcs(o[k])).join(',') + '}';
  }
  throw new Error('jcs: 지원하지 않는 값');
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const shortCode = (h: string | null | undefined) =>
  h ? (h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12)).toUpperCase() : '';

/** v3 증서 정규화: 증서에 찍히는 내용과 서명 메타만 담는다(상태·버전 등 진행 정보는 제외). */
export function canonicalV3(p: Pick<PromiseDoc,
  'code' | 'tpl' | 'title' | 'aName' | 'bName' | 'amount' | 'interestRate' | 'lateInterestRate' | 'repayAccount' |
  'item' | 'task' | 'deadline' | 'method' | 'penalty' | 'memo' | 'installments' | 'amendments' | 'sigA' | 'sigB'>): string {
  return jcs({
    v: 3,
    code: p.code,
    tpl: p.tpl,
    title: p.title || '',
    aName: p.aName || '',
    bName: p.bName || '',
    amount: p.amount ?? null,
    interestRate: p.interestRate ?? null,
    lateInterestRate: p.lateInterestRate ?? null,
    repayAccount: p.repayAccount || '',
    item: p.item || '',
    task: p.task || '',
    deadline: p.deadline || '',
    method: p.method || '',
    penalty: p.penalty || '',
    memo: p.memo || '',
    installments: (p.installments || []).map((x) => ({ amount: x.amount, date: x.date })),
    amendments: (p.amendments || []).map((x) => ({ at: x.at, text: x.text })),
    sigA: p.sigA ? { at: p.sigA.at, sha: p.sigA.sha } : null,
    sigB: p.sigB ? { at: p.sigB.at, sha: p.sigB.sha } : null,
  });
}

export const certHashV3 = (p: Parameters<typeof canonicalV3>[0]) => sha256Hex(canonicalV3(p));

// ---------- legacy v2 ----------
interface LegacySig { at: number; name: string; ph?: string; svHash?: string }
export interface LegacyPromise {
  id: string; tpl: string; title?: string; aName?: string; bName?: string; amount?: number | null;
  item?: string; task?: string; deadline?: string; method?: string; penalty?: string; memo?: string;
  installments?: { amount: number; date: string; paid?: boolean }[];
  amendments?: { at: number; text: string }[];
  sigA?: LegacySig | null; sigB?: LegacySig | null;
  [k: string]: unknown;
}

/** legacy/index.html canonical()과 동일한 문자열 (JSON.stringify 키 순서까지 같음) */
export function canonicalV2(p: LegacyPromise): string {
  const sig = (s: LegacySig | null | undefined) => (s ? { at: s.at, name: s.name, ph: s.ph || '', sv: s.svHash || '' } : null);
  return JSON.stringify({
    v: 2, id: p.id, tpl: p.tpl, title: p.title || '', aName: p.aName || '', bName: p.bName || '',
    amount: p.amount ?? null, item: p.item || '', task: p.task || '', deadline: p.deadline || '',
    method: p.method || '', penalty: p.penalty || '', memo: p.memo || '',
    installments: (p.installments || []).map((x) => ({ amount: x.amount, date: x.date })),
    amendments: (p.amendments || []).map((x) => ({ at: x.at, text: x.text })),
    sigA: sig(p.sigA), sigB: sig(p.sigB),
  });
}

/** 이벤트 체인 해시: sha256(prev_hash + canon + created_at ISO(ms, Z)) — DB 트리거와 같은 식 */
export const eventHash = (prevHash: string | null, canon: string, createdAtIso: string) =>
  sha256Hex((prevHash || '') + canon + new Date(createdAtIso).toISOString());
