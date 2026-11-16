// 상환 장부: 확인된 상환을 합쳐 남은 금액·진행률 계산, 여러 명 정산 금액 나누기
import { TPL } from './templates.ts';
import type { PromiseDoc } from './types.ts';

export interface PaymentLike { amount: number | null; confirmed_by_a: boolean | null; paid_on?: string | null; installment_no?: number | null }
export interface Ledger { total: number; paid: number; pending: number; remaining: number; ratio: number }

/** 돈 약속의 상환 현황. 금액이 없는 약속(물건·할 일)은 null */
export function ledgerOf(doc: Pick<PromiseDoc, 'tpl' | 'amount' | 'status'>, payments: PaymentLike[]): Ledger | null {
  if (TPL[doc.tpl].kind !== 'money' || !doc.amount) return null;
  const total = doc.amount;
  const paid = Math.min(total, payments.filter((p) => p.confirmed_by_a === true).reduce((n, p) => n + (Number(p.amount) || 0), 0));
  const pending = payments.filter((p) => p.confirmed_by_a === null).reduce((n, p) => n + (Number(p.amount) || 0), 0);
  const settled = doc.status === 'done' ? total : paid;
  return { total, paid: settled, pending, remaining: Math.max(0, total - settled), ratio: total ? Math.min(1, settled / total) : 0 };
}

/**
 * 여러 명 정산: 총액을 (멤버 수 + 내 몫)으로 나눈다. 10원 단위로 내리고, 남는 돈은 내 몫(포함 시) 또는 첫 멤버에게.
 * 돌려주는 값은 멤버별 금액(내 몫 제외)과 내 몫.
 */
export function splitShares(total: number, members: number, includeSelf: boolean): { each: number[]; mine: number } {
  const people = members + (includeSelf ? 1 : 0);
  if (members < 1 || people < 1 || total <= 0) return { each: [], mine: 0 };
  const base = Math.floor(total / people / 10) * 10 || Math.floor(total / people);
  const rest = total - base * people;
  const each = Array.from({ length: members }, (_, i) => base + (!includeSelf && i === 0 ? rest : 0));
  return { each, mine: includeSelf ? base + rest : 0 };
}
