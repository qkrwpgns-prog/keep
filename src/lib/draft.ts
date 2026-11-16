// 작성 중인 약속(로그인 전 포함)을 이 기기에 임시 저장 → 카카오 로그인으로 페이지가 바뀌어도 이어서 쓸 수 있다
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
