// 변제(이행) 완료 확인서 문구: 작성자(A)가 키프에서 '완료'를 확인한 기록으로 만든다.
import { TPL } from './templates.ts';
import { hangulAmount, pp, pRo, won } from './korean.ts';
import { korDate, kstYmd, stamp } from './dates.ts';
import type { PromiseDoc } from './types.ts';

type Doc = Pick<PromiseDoc, 'code' | 'tpl' | 'title' | 'aName' | 'bName' | 'amount' | 'item' | 'task' | 'deadline' | 'createdAt'>;
export interface ReceiptPayment { amount: number | null; paid_on: string | null; installment_no: number | null; created_at: string }

export interface ReceiptText {
  title: string;
  lead: string;
  rows: [string, string][];
  /** 상환 내역 표(돈 약속만) */
  payments: [string, string, string][];
  paidTotal: number | null;
}

const TITLES: Record<PromiseDoc['tpl'], string> = { loan: '변제 완료 확인서', split: '정산 완료 확인서', lend: '반환 완료 확인서', pledge: '이행 완료 확인서', team: '이행 완료 확인서' };
export const receiptTitle = (tpl: PromiseDoc['tpl']) => TITLES[tpl];

/** doneAt: 완료 이벤트의 서버 시각(ISO) */
export function receiptText(d: Doc, payments: ReceiptPayment[], doneAt: string): ReceiptText {
  const T = TPL[d.tpl];
  const made = d.createdAt ? stamp(d.createdAt).slice(0, 10).replace(/\./g, '. ') + '.' : '';
  const ref = `${made ? made + ' 작성한 ' : ''}${T.name}(증서번호 ${d.code})`;
  // 조사는 괄호 안 마지막 낱말(역할)에 맞춘다: '박제훈(빌려준 사람)은', '김민수(빌린 사람)로부터'
  const A = `${d.aName}(${T.a})`, B = `${d.bName}(${T.b})`;
  const Aeun = A + pp(T.a, '은', '는'), Bro = B + pRo(T.b) + '부터', Bga = B + pp(T.b, '이', '가');
  let lead: string;
  if (T.kind === 'money') {
    const amt = d.amount ? `금 ${hangulAmount(d.amount)}원정(${won(d.amount)})` : '약정 금액';
    lead = d.tpl === 'split'
      ? `${Aeun} ${Bro} ${ref}에 따른 정산 금액 ${amt} 전액을 받았음을 확인합니다.`
      : `${Aeun} ${Bro} ${ref}에 따른 ${amt} 전액을 변제받았음을 확인합니다.`;
  } else if (T.kind === 'item') {
    lead = `${Aeun} ${Bro} ${ref}에 따라 빌려준 물건(${d.item || '약정 물건'})을 돌려받았음을 확인합니다.`;
  } else {
    lead = `${Aeun} ${Bga} ${ref}에 따라 약속한 내용(${d.task || '약정 내용'})을 이행하였음을 확인합니다.`;
  }
  const confirmed = payments.filter((p) => p.amount);
  const paidTotal = T.kind === 'money' ? confirmed.reduce((n, p) => n + Number(p.amount), 0) : null;
  const rows: [string, string][] = [
    ['약속', d.title || T.name],
    [T.due, korDate(d.deadline)],
    ['완료 확인', `${stamp(doneAt)} (KST, 서버 시각)`],
  ];
  if (T.kind === 'money' && d.amount) {
    rows.splice(1, 0, [T.what, won(d.amount)]);
    if (paidTotal && paidTotal !== d.amount) rows.push(['기록된 상환 합계', `${won(paidTotal)} (나머지는 기록 없이 완료 처리)`]);
    if (!paidTotal) rows.push(['상환 기록', '건별 기록 없음 (작성자가 전액 받았다고 완료 처리)']);
  }
  return {
    title: TITLES[d.tpl],
    lead,
    rows,
    payments: confirmed.map((p) => [korDate(p.paid_on || kstYmd(new Date(p.created_at))), won(p.amount), p.installment_no != null ? `${p.installment_no + 1}회차` : '']),
    paidTotal,
  };
}
