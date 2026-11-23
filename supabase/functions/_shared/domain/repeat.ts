// 반복 약속: '매달 25일 5만원씩 12회' 같은 규칙 → 회차 목록(분할과 같은 구조라 알림·장부·완료를 그대로 쓴다)
import { addDays, isYmd } from './dates.ts';
import { won } from './korean.ts';
import type { Installment } from './types.ts';

export interface RepeatRule { every: 'week' | 'month'; count: number; per: number; first: string }
export const REPEAT_MAX = 24;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1~12
/** first(YYYY-MM-DD)에서 i달 뒤 같은 날(없으면 그 달 마지막 날) */
export function addMonthsClamp(first: string, i: number): string {
  const [y, m, d] = first.split('-').map(Number);
  const t = m - 1 + i, yy = y + Math.floor(t / 12), mm = (t % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, lastDay(yy, mm)))}`;
}

/** 규칙 검사. 문제가 없으면 null */
export function repeatError(r: Partial<RepeatRule> | null | undefined, today: string): string | null {
  if (!r) return '반복 규칙이 없어요.';
  if (r.every !== 'week' && r.every !== 'month') return '반복 주기를 골라 주세요.';
  if (!Number.isInteger(r.count) || r.count! < 2 || r.count! > REPEAT_MAX) return `반복 횟수는 2~${REPEAT_MAX}회로 정해 주세요.`;
  if (!Number.isInteger(r.per) || r.per! <= 0 || r.per! > 100_000_000) return '회당 금액을 적어 주세요.';
  if (!isYmd(r.first)) return '첫 날짜를 골라 주세요.';
  if (r.first! < today) return '첫 날짜는 오늘이나 그 뒤여야 해요.';
  return null;
}

export function repeatPlan(r: RepeatRule): Installment[] {
  return Array.from({ length: r.count }, (_, i) => ({ amount: r.per, date: r.every === 'week' ? addDays(r.first, 7 * i) : addMonthsClamp(r.first, i), paid: false }));
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 회차 목록이 반복 규칙에서 나온 모양이면 '매달 25일 50,000원씩 12회' 같은 설명, 아니면 null */
export function describeRepeat(inst: Pick<Installment, 'amount' | 'date'>[]): string | null {
  if (!inst || inst.length < 2 || !inst.every((x) => x.amount === inst[0].amount && isYmd(x.date))) return null;
  const first = inst[0].date;
  const amt = won(inst[0].amount);
  if (inst.every((x, i) => x.date === addDays(first, 7 * i))) {
    const dow = DOW[new Date(first + 'T00:00:00Z').getUTCDay()];
    return `매주 ${dow}요일 ${amt}씩 ${inst.length}회`;
  }
  if (inst.every((x, i) => x.date === addMonthsClamp(first, i))) return `매달 ${Number(first.slice(8))}일 ${amt}씩 ${inst.length}회`;
  return null;
}
