// 작성 중인 약속(로그인 전 포함)을 이 기기에 임시 저장 → 로그인하거나 새로고침해도 이어서 쓸 수 있다
import { emptyFields, type DraftFields } from '@domain/types.ts';
import type { TemplateKey } from '@domain/templates.ts';
import type { Strokes } from '../components/SignaturePad';

export interface Draft {
  step: 1 | 2 | 3;
  tpl: TemplateKey;
  inputMode: 'text' | 'manual';
  raw: string;
  myName: string;
  f: DraftFields;
  questions: string[];
  quote: string;
  strokes: Strokes;
  agree: boolean;
  editId?: string;
  editVersion?: number;
  aiFilled?: boolean;
  /** 여러 명 정산: 켜면 상대 1명 대신 멤버 목록·총액으로 한 번에 만든다 */
  group?: { on: boolean; members: string; total: string; includeSelf: boolean };
  /** 반복 약속(돈 약속): 매주·매달 같은 금액을 정해진 횟수만큼 */
  repeat?: { on: boolean; every: 'week' | 'month'; count: string; per: string; first: string };
}

const KEY = 'keep.draft.v2';
export const newDraft = (): Draft => ({ step: 1, tpl: 'loan', inputMode: 'text', raw: '', myName: '', f: emptyFields(), questions: [], quote: '', strokes: [], agree: false });

export function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d && d.f) return { ...newDraft(), ...d, f: { ...emptyFields(), ...d.f } };
  } catch { /* 저장 불가 환경 */ }
  return newDraft();
}
export function saveDraft(d: Draft) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 무시 */ } }
export function clearDraft() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }
