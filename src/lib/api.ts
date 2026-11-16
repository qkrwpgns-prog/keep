import { supabase, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { rowToDoc, type PartyRow, type PromiseRow } from '@domain/mapping.ts';
import type { PromiseDoc, SigVector } from '@domain/types.ts';
import type { EventRow } from '@domain/events.ts';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function callFn<T = Record<string, unknown>>(name: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '인터넷 연결을 확인해 주세요.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, out.error || 'SERVER', out.message || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
  return out as T;
}

export const action = <T = Record<string, unknown>>(body: Record<string, unknown>) => callFn<T>('promise-action', body);
export const preview = (code: string) => callFn<PublicPreview>('promise-public', { code });
export const deleteAccount = () => callFn('account', { action: 'delete', confirm: '탈퇴' });

export interface PublicPreview {
  code: string; tpl: PromiseDoc['tpl']; title: string; status: PromiseDoc['status']; aName: string; bName: string;
  amount: number | null; interestRate: number | null; lateInterestRate: number | null; item: string; task: string;
  deadline: string; method: string; penalty: string; hasAccount: boolean; hasMemo: boolean;
  signedA: boolean; signedB: boolean; bLinked: boolean; createdAt: string;
}

const PARTY_COLS = 'promise_id, role, user_id, display_name, signature_sha256, signed_at, consent_at';

export interface ListItem { doc: PromiseDoc; myRole: 'A' | 'B'; reviseNote: string }

export async function listMine(userId: string): Promise<ListItem[]> {
  const { data, error } = await supabase.from('promises').select(`*, parties(${PARTY_COLS})`).order('created_at', { ascending: false }).limit(200);
  if (error) throw new ApiError(500, 'LOAD', '약속을 불러오지 못했어요.');
  return (data as (PromiseRow & { parties: PartyRow[]; revise_note: string | null })[]).map((r) => ({
    doc: rowToDoc(r, r.parties),
    myRole: (r.parties.find((p) => p.user_id === userId)?.role || 'A') as 'A' | 'B',
    reviseNote: r.revise_note || '',
  }));
}

export interface RequestRow { id: string; kind: 'extend' | 'split'; new_deadline: string | null; installments: { amount: number; date: string }[] | null; note: string | null; status: string; created_at: string }
export interface PaymentRow { id: string; amount: number | null; paid_on: string | null; installment_no: number | null; note: string | null; confirmed_by_a: boolean | null; created_at: string }

export interface Detail {
  doc: PromiseDoc; myRole: 'A' | 'B'; reviseNote: string; legacy: boolean; canonicalVersion: number; legacyDoc: unknown;
  parties: PartyRow[]; events: EventRow[]; requests: RequestRow[]; payments: PaymentRow[];
}

/** 당사자면 상세, 아니면 null (RLS) */
export async function loadDetail(code: string, userId: string): Promise<Detail | null> {
  const { data, error } = await supabase.from('promises').select(`*, parties(${PARTY_COLS})`).eq('share_code', code).maybeSingle();
  if (error) throw new ApiError(500, 'LOAD', '약속을 불러오지 못했어요.');
  if (!data) return null;
  const r = data as PromiseRow & { parties: PartyRow[]; revise_note: string | null; legacy_doc: unknown; canonical_version: number };
  const [ev, rq, pm] = await Promise.all([
    supabase.from('events').select('*').eq('promise_id', r.id).order('id'),
    supabase.from('requests').select('*').eq('promise_id', r.id).order('created_at'),
    supabase.from('payments').select('id, promise_id, amount, paid_on, installment_no, note, ai_reading, confirmed_by_a, created_at, answered_at').eq('promise_id', r.id).order('created_at'),
  ]);
  return {
    doc: rowToDoc(r, r.parties),
    myRole: (r.parties.find((p) => p.user_id === userId)?.role || 'A') as 'A' | 'B',
    reviseNote: r.revise_note || '',
    legacy: !!r.legacy_doc,
    legacyDoc: r.legacy_doc,
    canonicalVersion: r.canonical_version,
    parties: r.parties,
    events: (ev.data || []) as EventRow[],
    requests: (rq.data || []) as RequestRow[],
    payments: (pm.data || []) as PaymentRow[],
  };
}

const sigCache = new Map<string, { A: SigVector | null; B: SigVector | null }>();
export async function loadSignatures(id: string, key: string) {
  const k = id + key;
  const hit = sigCache.get(k);
  if (hit) return hit;
  const r = await action<{ A: { strokes: SigVector } | null; B: { strokes: SigVector } | null }>({ action: 'signatures', id });
  const out = { A: r.A?.strokes ?? null, B: r.B?.strokes ?? null };
  sigCache.set(k, out);
  return out;
}
