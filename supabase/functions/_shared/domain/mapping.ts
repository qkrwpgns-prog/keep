// DB 행(snake_case) ↔ 증서 문서(camelCase)
import type { PromiseDoc, SigMeta } from './types.ts';
import type { PromiseStatus, TemplateKey } from './templates.ts';

export const SHARE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const SHARE_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export function newShareCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  // 31글자 알파벳: 248 미만 값만 써서 치우침 제거
  let out = '';
  let i = 0;
  while (out.length < 8) {
    if (i >= bytes.length) { crypto.getRandomValues(bytes); i = 0; }
    const b = bytes[i++];
    if (b < 248) out += SHARE_ALPHABET[b % 31];
  }
  return out;
}
export const normalizeShareCode = (s: string) => String(s || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');

export interface PromiseRow {
  id: string;
  share_code: string;
  template: TemplateKey;
  title: string;
  amount: number | string | null;
  interest_rate: number | string | null;
  late_interest_rate: number | string | null;
  repay_account: string | null;
  item: string | null;
  task: string | null;
  deadline: string | null;
  method: string | null;
  penalty: string | null;
  memo: string | null;
  installments: { amount: number; date: string; paid?: boolean }[] | null;
  amendments: { at: string; text: string }[] | null;
  status: PromiseStatus;
  current_hash: string | null;
  deadline_version: number;
  version: number;
  is_demo: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  retain_until?: string | null;
  done_at?: string | null;
}

export interface PartyRow {
  promise_id: string;
  role: 'A' | 'B';
  user_id: string | null;
  display_name: string;
  signature_path?: string | null;
  signature_sha256: string | null;
  signed_at: string | null;
  signer_ip?: string | null;
  signer_ua?: string | null;
  consent_at: string | null;
  consent_version?: string | null;
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const iso = (t: string | null | undefined) => (t ? new Date(t).toISOString() : '');

export function rowToDoc(r: PromiseRow, parties: PartyRow[]): PromiseDoc {
  const A = parties.find((x) => x.role === 'A');
  const B = parties.find((x) => x.role === 'B');
  const sig = (x?: PartyRow): SigMeta | null => (x && x.signed_at && x.signature_sha256 ? { at: iso(x.signed_at), sha: x.signature_sha256 } : null);
  return {
    id: r.id,
    code: r.share_code,
    tpl: r.template,
    title: r.title || '',
    aName: A?.display_name || '',
    bName: B?.display_name || '',
    amount: num(r.amount),
    interestRate: num(r.interest_rate),
    lateInterestRate: num(r.late_interest_rate),
    repayAccount: r.repay_account || '',
    item: r.item || '',
    task: r.task || '',
    deadline: r.deadline || '',
    method: r.method || '',
    penalty: r.penalty || '',
    memo: r.memo || '',
    installments: (r.installments || []).map((x) => ({ amount: Number(x.amount), date: x.date, paid: !!x.paid })),
    amendments: (r.amendments || []).map((x) => ({ at: iso(x.at), text: x.text })),
    sigA: sig(A),
    sigB: sig(B),
    status: r.status,
    currentHash: r.current_hash || '',
    createdAt: iso(r.created_at),
    version: r.version,
    isDemo: !!r.is_demo,
    deadlineVersion: r.deadline_version || 1,
  };
}
