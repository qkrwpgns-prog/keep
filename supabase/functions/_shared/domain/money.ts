// 받을 돈·갚을 돈 현황. 돈 약속은 언제나 작성자(A)가 받고 상대방(B)이 갚는다.
import { TPL } from './templates.ts';
import { diffDays, isYmd } from './dates.ts';
import { ledgerOf, type PaymentLike } from './ledger.ts';
import type { PromiseDoc } from './types.ts';

type Doc = Pick<PromiseDoc, 'id' | 'code' | 'tpl' | 'title' | 'amount' | 'status' | 'deadline' | 'installments' | 'aName' | 'bName' | 'isDemo'>;
export interface MoneyItem { doc: Doc; myRole: 'A' | 'B' }

export interface MoneyRow {
  id: string; code: string; title: string; other: string; dir: 'in' | 'out';
  total: number; paid: number; pending: number; remaining: number;
  /** 다음 기한(분할이면 다음 회차 날짜) */
  due: string; dueAmount: number; daysLeft: number; overdue: boolean;
}
export interface MoneySide { remaining: number; overdue: number; count: number; paid: number }
export interface MoneyPerson { name: string; incoming: number; outgoing: number; net: number }
export interface MoneySummary { incoming: MoneySide; outgoing: MoneySide; rows: MoneyRow[]; people: MoneyPerson[]; waitingSign: { in: number; out: number } }

const side = (rows: MoneyRow[]): MoneySide => ({
  remaining: rows.reduce((n, r) => n + r.remaining, 0),
  overdue: rows.filter((r) => r.overdue).reduce((n, r) => n + r.remaining, 0),
  count: rows.length,
  paid: rows.reduce((n, r) => n + r.paid, 0),
});

/**
 * 진행 중(서명 완료·미완료)인 돈 약속만 센다. 시연·서명 대기는 빼고, 서명 대기 금액은 따로 알려 준다.
 * payments는 약속 id별 상환 기록(확인됨만 갚은 것으로 침).
 */
export function moneySummary(items: MoneyItem[], payments: Record<string, PaymentLike[]>, today: string): MoneySummary {
  const rows: MoneyRow[] = [];
  const waitingSign = { in: 0, out: 0 };
  for (const { doc, myRole } of items) {
    if (doc.isDemo || TPL[doc.tpl].kind !== 'money' || !doc.amount) continue;
    if (doc.status === 'pending_b' || doc.status === 'revise') { waitingSign[myRole === 'A' ? 'in' : 'out'] += doc.amount; continue; }
    if (doc.status !== 'active' && doc.status !== 'reported') continue;
    const l = ledgerOf(doc, payments[doc.id] || [])!;
    if (l.remaining <= 0) continue;
    const next = doc.installments.find((i) => !i.paid);
    const due = next?.date || doc.deadline;
    const daysLeft = isYmd(due) ? diffDays(due, today) : 9999;
    rows.push({
      id: doc.id, code: doc.code, title: doc.title || TPL[doc.tpl].name, other: (myRole === 'A' ? doc.bName : doc.aName).trim() || '상대방',
      dir: myRole === 'A' ? 'in' : 'out', total: l.total, paid: l.paid, pending: l.pending, remaining: l.remaining,
      due, dueAmount: Math.min(next?.amount ?? l.remaining, l.remaining), daysLeft, overdue: daysLeft < 0,
    });
  }
  rows.sort((a, b) => a.daysLeft - b.daysLeft || b.remaining - a.remaining);
  const byName = new Map<string, MoneyPerson>();
  for (const r of rows) {
    const p = byName.get(r.other) || { name: r.other, incoming: 0, outgoing: 0, net: 0 };
    if (r.dir === 'in') p.incoming += r.remaining; else p.outgoing += r.remaining;
    p.net = p.incoming - p.outgoing;
    byName.set(r.other, p);
  }
  const people = [...byName.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name, 'ko'));
  return { incoming: side(rows.filter((r) => r.dir === 'in')), outgoing: side(rows.filter((r) => r.dir === 'out')), rows, people, waitingSign };
}
