// 증서 HTML (legacy certBody·sigBox·certHTML 이식). 화면·파일 저장·위변조 검사가 같은 함수를 쓴다.
// data-f 속성은 위변조 검사에서 화면 글자와 내장 데이터를 비교하는 데 쓰인다.

import { TPL } from './templates.ts';
import { korDate, stamp } from './dates.ts';
import { hangulAmount, maskAccount, pp, won } from './korean.ts';
import { shortCode } from './canonical.ts';
import type { PromiseDoc } from './types.ts';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type CertDoc = Pick<PromiseDoc,
  'code' | 'tpl' | 'title' | 'aName' | 'bName' | 'amount' | 'interestRate' | 'lateInterestRate' | 'repayAccount' |
  'item' | 'task' | 'deadline' | 'method' | 'penalty' | 'memo' | 'installments' | 'amendments' | 'sigA' | 'sigB' | 'createdAt'> & {
  currentHash?: string;
};

export function certBody(p: CertDoc, opts: { revealAccount?: boolean } = {}) {
  const T = TPL[p.tpl] || TPL.pledge;
  const A = esc(p.aName || '(이름)'), B = esc(p.bName || '(이름)');
  const a = `<b data-f="aName">${A}</b>`, b = `<b data-f="bName">${B}</b>`;
  const lead = {
    loan: `${b}${pp(p.bName, '은', '는')} ${a}${pp(p.aName, '으로', '로')}부터 아래 금액을 빌렸음을 확인하고, 약속한 날까지 갚을 것을 약속합니다.`,
    lend: `${b}${pp(p.bName, '은', '는')} ${a}${pp(p.aName, '으로', '로')}부터 아래 물건을 빌렸음을 확인하고, 약속한 날까지 돌려줄 것을 약속합니다.`,
    pledge: `${b}${pp(p.bName, '은', '는')} ${a}에게 아래 내용을 지킬 것을 약속합니다.`,
    team: `${b}${pp(p.bName, '은', '는')} ${a}${pp(p.aName, '과', '와')} 합의한 아래 역할을 기한까지 완료할 것을 약속합니다.`,
    split: `${b}${pp(p.bName, '은', '는')} ${a}${pp(p.aName, '이', '가')} 먼저 낸 비용 중 자기 몫을 약속한 날까지 정산할 것을 약속합니다.`,
  }[p.tpl] || '';
  const whatVal = T.kind === 'money'
    ? `<span data-f="amount">${esc(won(p.amount))}</span>${p.amount ? ` <span style="color:#7a705f">(금 ${hangulAmount(p.amount)}원정)</span>` : ''}`
    : `<span data-f="${T.kind === 'item' ? 'item' : 'task'}">${esc(T.kind === 'item' ? p.item : p.task)}</span>`;
  let rows = `<tr><th>${T.what}</th><td>${whatVal}</td></tr><tr><th>${T.due}</th><td data-f="deadline">${esc(korDate(p.deadline))}</td></tr>`;
  if (p.interestRate) rows += `<tr><th>이자</th><td data-f="interestRate">연 ${esc(p.interestRate)}%</td></tr>`;
  if (p.lateInterestRate) rows += `<tr><th>연체이자</th><td data-f="lateInterestRate">연 ${esc(p.lateInterestRate)}%</td></tr>`;
  if (p.installments && p.installments.length) {
    rows += `<tr><th>나눠서 이행</th><td>${p.installments.map((x, i) => `${i + 1}회 ${esc(korDate(x.date))} ${esc(won(x.amount))}${x.paid ? ' ✓' : ''}`).join('<br>')}</td></tr>`;
  }
  rows += `<tr><th>${T.how}</th><td data-f="method">${esc(p.method || '정하지 않음')}</td></tr>`;
  if (p.repayAccount) rows += `<tr><th>받을 계좌</th><td data-f="repayAccount">${esc(opts.revealAccount ? p.repayAccount : maskAccount(p.repayAccount))}</td></tr>`;
  if (p.penalty) rows += `<tr><th>어겼을 때</th><td data-f="penalty">${esc(p.penalty)}</td></tr>`;
  if (p.memo) rows += `<tr><th>특약·메모</th><td data-f="memo">${esc(p.memo)}</td></tr>`;
  return { lead, rows };
}

function sigBox(p: CertDoc, who: 'A' | 'B', img?: string) {
  const s = who === 'A' ? p.sigA : p.sigB, T = TPL[p.tpl] || TPL.pledge;
  const role = who === 'A' ? `작성자 · ${T.a}` : `상대방 · ${T.b}`;
  const nm = who === 'A' ? p.aName : p.bName;
  if (!s) return `<div class="sig"><div class="role">${role}</div><div class="nm">${esc(nm)}</div><div class="wait">서명 대기 중</div></div>`;
  return `<div class="sig"><div class="role">${role}</div><div class="nm">${esc(nm)}</div>${img ? `<img alt="${esc(nm)} 서명" src="${esc(img)}">` : '<div class="wait">서명 이미지</div>'}<div class="meta">${stamp(s.at)} 서명<br>로그인 계정으로 본인 확인<br>서명 지문 ${esc(s.sha.slice(0, 8).toUpperCase())}</div></div>`;
}

/** 증거로 쓰면 안 되는 증서 표시 */
export const DEMO_FLAG = '시연용 증서 — 실제 약속의 증거가 아닙니다';
export const LEGACY_FLAG = '이전 버전에서 가져온 기록 — 키프 서버가 서명을 직접 확인하지 않았습니다';
export const certFlag = (o: { isDemo?: boolean; legacy?: boolean }) => (o.isDemo ? DEMO_FLAG : o.legacy ? LEGACY_FLAG : undefined);

export function certHTML(p: CertDoc, opts: { sigImgA?: string; sigImgB?: string; qrSvg?: string; revealAccount?: boolean; flag?: string } = {}) {
  const T = TPL[p.tpl] || TPL.pledge, { lead, rows } = certBody(p, opts);
  const full = !!(p.sigA && p.sigB);
  const amend = (p.amendments || []).length
    ? `<div class="amend"><b>변경 이력</b><br>${p.amendments.map((a) => `${stamp(a.at)} · ${esc(a.text)}`).join('<br>')}</div>` : '';
  const vf = full && p.currentHash
    ? `<div class="vf">${opts.qrSvg ? `<div class="qr">${opts.qrSvg}</div>` : ''}<div>확인코드 <b style="font-size:13px;color:#211d18">${shortCode(p.currentHash)}</b><br>SHA-256 <code>${p.currentHash}</code><br>키프 '위변조 확인'에서 이 증서를 검사할 수 있습니다.</div></div>` : '';
  return `<div class="cert">${opts.flag ? `<div class="cert-flag">${esc(opts.flag)}</div>` : full ? '<div class="stamp">키프<br>확인</div>' : ''}
  <div class="ct">${esc(T.name)}</div><div class="cno">증서번호 ${esc(p.code)} · 작성 ${p.createdAt ? stamp(p.createdAt) : ''}</div>
  <p class="lead">${lead}</p><table>${rows}</table>${amend}
  <div class="sigs">${sigBox(p, 'A', opts.sigImgA)}${sigBox(p, 'B', opts.sigImgB)}</div>${vf}
  <div class="note">이 증서는 당사자가 직접 확인·서명한 약속 기록으로, 분쟁 시 약속이 있었음을 입증하는 자료로 쓸 수 있습니다. 법률 자문이 아니며, 공증 문서가 아니어서 이것만으로 강제집행을 할 수는 없습니다. 원본 대화와 송금 내역을 함께 보관하세요.</div></div>`;
}

/** 위변조 검사에서 쓰는 data-f 항목 이름 */
export const FIELD_LABELS: Record<string, string> = {
  aName: '작성자', bName: '상대방', amount: '금액', item: '물건', task: '약속 내용', deadline: '기한', method: '방법',
  penalty: '어겼을 때', memo: '메모', interestRate: '이자', lateInterestRate: '연체이자', repayAccount: '계좌',
};
