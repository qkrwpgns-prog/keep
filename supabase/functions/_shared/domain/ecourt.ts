// 전자소송 제출 준비용 묶음: 증거(갑 제n호증) 목록과 청구 내용 정리(참고용).
// 법률 문서를 대신 쓰는 것이 아니라, 당사자가 직접 제출할 때 필요한 자료를 정리해 주는 것이다.
import { TPL } from './templates.ts';
import { diffDays, isYmd, kstYmd } from './dates.ts';
import { pp, pRo, won } from './korean.ts';
import { ledgerOf, type PaymentLike } from './ledger.ts';
import type { PromiseDoc } from './types.ts';

type Doc = Pick<PromiseDoc, 'code' | 'tpl' | 'title' | 'aName' | 'bName' | 'amount' | 'item' | 'task' | 'deadline' | 'createdAt' | 'status' | 'lateInterestRate' | 'interestRate'>;
export interface EcourtEvent { type: string; created_at: string; payload?: unknown }

export interface EcourtItem { no: string; file: string; name: string; date: string; purpose: string; kind: 'cert' | 'records' | 'nudges' | 'proof'; proofIndex?: number }
export interface EcourtPlan { items: EcourtItem[]; summary: [string, string][]; notes: string[] }

const ymd = (iso: string) => kstYmd(new Date(iso));
const dot = (d: string) => (isYmd(d) ? d.replace(/-/g, '. ') + '.' : d);
const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '');

/** 증서 내용으로 입증취지(무엇을 증명하는 자료인지) 한 줄 */
export function certPurpose(d: Doc): string {
  const A = d.aName, B = d.bName, due = dot(d.deadline);
  const Bi = B + pp(B, '이', '가'), Aro = A + pRo(A) + '부터';
  switch (d.tpl) {
    case 'loan': return `${Bi} ${Aro} ${won(d.amount)}을 빌리고 ${due}까지 갚기로 약정한 사실`;
    case 'split': return `${Bi} ${A}에게 정산 금액 ${won(d.amount)}을 ${due}까지 지급하기로 확인한 사실`;
    case 'lend': return `${Bi} ${Aro} ${d.item}${pp(d.item, '을', '를')} 빌리고 ${due}까지 돌려주기로 약정한 사실`;
    default: return `${Bi} ${A}에게 '${d.task}'${pp(d.task, '을', '를')} ${due}까지 하기로 약정한 사실`;
  }
}

/**
 * events: 전체 증거 기록, payments: 상환 기록(확인된 것만 변제로 셈), proofs: 첨부 캡처 수, today: 기준일(KST)
 */
export function ecourtPlan(d: Doc, events: EcourtEvent[], payments: PaymentLike[], proofs: number, today: string): EcourtPlan {
  const T = TPL[d.tpl];
  const made = d.createdAt ? ymd(d.createdAt) : '';
  const items: EcourtItem[] = [];
  let n = 0;
  const add = (it: Omit<EcourtItem, 'no' | 'file'>, file: string) => { n++; items.push({ ...it, no: `갑 제${n}호증`, file: `갑제${n}호증_${safe(file)}.pdf` }); };
  add({ name: `${T.name} (전자 약속증서)`, date: made, purpose: certPurpose(d), kind: 'cert' }, T.name);
  add({ name: '전자서명 및 증거 기록 내역', date: made, purpose: '양 당사자가 각자 로그인한 계정으로 위 증서에 전자서명한 사실, 서명 이후 기록이 바뀌지 않은 사실(SHA-256 해시 사슬)', kind: 'records' }, '전자서명및기록');
  const nudges = events.filter((e) => e.type === 'nudge_sent' || e.type === 'notice_sent');
  if (nudges.length) {
    const dates = [...new Set(nudges.map((e) => dot(ymd(e.created_at))))].join(', ');
    add({ name: '이행 촉구 기록', date: ymd(nudges[nudges.length - 1].created_at), purpose: `${d.aName}${pp(d.aName, '이', '가')} ${dates}에 ${d.bName}에게 이행을 촉구한 사실`, kind: 'nudges' }, '이행촉구기록');
  }
  if (proofs > 0) {
    n++;
    for (let i = 0; i < proofs; i++) items.push({ no: `갑 제${n}호증의${i + 1}`, file: `갑제${n}호증의${i + 1}_송금캡처.pdf`, name: '송금 내역 캡처', date: '', purpose: `${d.bName}${pp(d.bName, '이', '가')} 일부 변제한 사실(변제된 금액은 청구 금액에서 뺌)`, kind: 'proof', proofIndex: i });
  }

  const summary: [string, string][] = [
    ['증서 상 당사자', `${d.aName}(${T.a}) · ${d.bName}(${T.b})`],
    ['약속', `${d.title || T.name} · 증서번호 ${d.code}`],
    ['작성일', dot(made)],
    [T.due, dot(d.deadline)],
  ];
  const late = isYmd(d.deadline) ? diffDays(today, d.deadline) : 0;
  if (late > 0) summary.push(['기한 경과', `${late}일 (${dot(today)} 기준)`]);
  const l = ledgerOf(d, payments);
  if (l) {
    summary.push([T.what, won(l.total)]);
    summary.push(['확인된 변제액', won(l.paid) || '0원']);
    summary.push(['남은 금액(청구 검토 금액)', won(l.remaining) || '0원']);
    if (d.interestRate) summary.push(['약정 이자', `연 ${d.interestRate}%`]);
    if (d.lateInterestRate) summary.push(['약정 연체이자', `연 ${d.lateInterestRate}%`]);
  } else {
    summary.push([T.what, d.item || d.task]);
  }
  if (nudges.length) summary.push(['이행 촉구', `${nudges.length}회 (${dot(ymd(nudges[0].created_at))} ~ ${dot(ymd(nudges[nudges.length - 1].created_at))})`]);

  const notes = [
    '이 자료는 키프 기록을 정리한 참고 자료이며 법률 자문이 아닙니다. 청구 금액·이자·관할은 직접 확인하거나 대한법률구조공단(국번 없이 132)에 상담하세요.',
    '전자소송은 대한민국 법원 전자소송 사이트(ecfs.scourt.go.kr)에서 공동인증서 등으로 로그인해 진행합니다. 3,000만 원 이하 금전 청구는 소액사건, 다툼이 적으면 지급명령 신청을 검토할 수 있습니다.',
    '증서의 이름은 별명일 수 있어요. 소장·신청서에는 상대방의 실명과 주소(또는 연락처로 주소 보정)가 필요합니다.',
    '증거는 이 묶음의 파일을 호증 번호 순서대로 따로 올리면 됩니다. 증거목록의 입증취지는 상황에 맞게 고쳐 쓰세요.',
  ];
  return { items, summary, notes };
}
