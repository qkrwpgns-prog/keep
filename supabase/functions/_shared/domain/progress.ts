// 진행 계산: 오늘·단계·분할 계획·표시용 문자열
import { TPL } from './templates.ts';
import { addDays, diffDays, isYmd, stageOf } from './dates.ts';
import { won } from './korean.ts';
import type { Installment, PromiseDoc } from './types.ts';

export const subjectText = (p: Pick<PromiseDoc, 'tpl' | 'amount' | 'item' | 'task'>) => {
  const k = TPL[p.tpl]?.kind;
  return k === 'money' ? won(p.amount) : k === 'item' ? p.item || '' : p.task || '';
};

/** 진행 중 약속의 재촉 단계(0~5). today는 KST 'YYYY-MM-DD'(시연 시 되감은 날짜) */
export const promiseStage = (p: Pick<PromiseDoc, 'status' | 'deadline'>, today: string) =>
  (p.status === 'active' || p.status === 'reported') && isYmd(p.deadline) ? stageOf(diffDays(today, p.deadline)) : 0;

/** 분할 이행 계획 (legacy splitPlan) */
export function splitPlan(total: number, parts: number, every: number, deadline: string, today: string): Installment[] {
  const n = parts || 2, step = every || 14;
  const base = Math.floor(total / n / 1000) * 1000 || Math.floor(total / n);
  const start = diffDays(today, deadline) > 0 ? today : deadline;
  return Array.from({ length: n }, (_, i) => ({ amount: i === n - 1 ? total - base * (n - 1) : base, date: addDays(start, 7 + step * i), paid: false }));
}
