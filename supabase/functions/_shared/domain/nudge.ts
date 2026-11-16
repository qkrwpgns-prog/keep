// 재촉 문구·이행 촉구서·금지어·야간 발송 금지 (legacy nudgeBank·noticeText 이식)
import { TPL } from './templates.ts';
import { addDays, diffDays, kstHour, korDate } from './dates.ts';
import { callName, hangulAmount, pp } from './korean.ts';
import { shortCode } from './canonical.ts';
import { subjectText } from './progress.ts';
import type { PromiseDoc } from './types.ts';

export type Relation = '친구' | '후배' | '조원' | '가족' | '선배' | '지인';
export interface NudgeOption { label: string; text: string }

/** 선배·지인은 존댓말 */
export const isHonorific = (rel: string) => rel === '선배' || rel === '지인';

/** 단계(3=1차, 4=2차)·어조(1~5)·관계로 메시지 3안 */
export function nudgeBank(p: Pick<PromiseDoc, 'tpl' | 'amount' | 'item' | 'task' | 'bName' | 'deadline'>, stage: number, tone: number, rel: string, today: string): NudgeOption[] {
  const hon = isHonorific(rel);
  const N = hon ? `${p.bName}님` : callName(p.bName), s = subjectText(p), d = korDate(p.deadline);
  const late = diffDays(today, p.deadline), nd = korDate(addDays(today, 7));
  const band = Math.min(3, (tone <= 2 ? 1 : tone === 3 ? 2 : 3) + (stage === 4 ? 1 : 0)) as 1 | 2 | 3;
  const H = {
    1: [{ label: '안부형', text: `${N} 잘 지내요? 다름이 아니라 ${d}까지 하기로 한 ${s} 건이 생각나서 연락드려요. 언제쯤 가능할지 알려주실 수 있을까요?` },
      { label: '가볍게', text: `${N}, 혹시 ${s} 약속 기억하세요? 기한이 ${late}일 지나서 한 번 여쭤봐요. 편한 날짜 알려주시면 맞출게요!` },
      { label: '배려형', text: `요즘 바쁘신 것 같아 조심스럽게 말씀드려요. ${s} 건, 이번 주 안에 어떻게 할지만 정해주실 수 있을까요? 나눠서 주셔도 괜찮아요.` }],
    2: [{ label: '날짜 확인', text: `${N}, ${d}까지였던 ${s} 약속이 ${late}일 지났어요. 언제 가능하신지 날짜로 알려주시면 좋겠어요.` },
      { label: '선택지 제안', text: `${s} 건으로 연락드려요. 이번 주에 한 번에 주시거나, 어려우면 키프에서 연장·분할 요청을 보내주세요.` },
      { label: '정중하게', text: `바쁘신 와중에 죄송해요. ${s} 약속이 기한을 넘겨서 확인차 연락드려요. 이번 주 금요일까지 답 주실 수 있을까요?` }],
    3: [{ label: '기한 제시', text: `${N}, ${s} 약속이 ${late}일 지났어요. ${nd}까지는 꼭 이행해 주세요. 어려우면 그 전에 연장 요청을 보내주세요.` },
      { label: '분할 제안', text: `한 번에 어렵다면 나눠서라도 괜찮아요. 다만 언제 얼마씩 할지 오늘 안에 정해서 알려주세요. 서로 서명한 키프 증서에 남아 있는 약속이에요.` },
      { label: '분명하게', text: `${s} 약속, 더 미루기는 어려워요. ${nd}까지 연락이 없으면 정식으로 이행 촉구서를 보낼게요.` }],
  };
  const B = {
    1: [{ label: '안부형', text: `${N} 잘 지내? 다름이 아니라 ${d}까지 하기로 한 ${s} 건 생각나서 연락했어. 언제쯤 가능할지 알려줄래?` },
      { label: '가볍게', text: `혹시 ${s} 약속 기억나? 기한이 ${late}일 지나서 한 번 물어봐! 편한 날짜 알려주면 그때 맞춰볼게 ㅎㅎ` },
      { label: '배려형', text: `요즘 바쁜 거 알아서 조심스럽게 말하는데, ${s} 건 이번 주 안에 어떻게 할지만 정해줄 수 있을까? 나눠서 줘도 괜찮아.` }],
    2: [{ label: '날짜 확인', text: `${N}, ${d}까지였던 ${s} 약속이 ${late}일 지났어. 언제 가능한지 날짜로 알려줘.` },
      { label: '선택지 제안', text: `${s} 건 때문에 연락했어. 이번 주에 한 번에 주거나, 어려우면 키프에서 연장이나 분할 요청 보내줘.` },
      { label: '정중하게', text: `바쁜데 미안. ${s} 약속이 기한 넘어서 확인차 연락했어. 이번 주 금요일까지 답 줄 수 있어?` }],
    3: [{ label: '기한 제시', text: `${N}, ${s} 약속이 ${late}일 지났어. ${nd}까지는 꼭 해줘. 어려우면 그 전에 연장 요청 보내줘.` },
      { label: '분할 제안', text: `한 번에 어려우면 나눠서라도 괜찮아. 대신 언제 얼마씩 줄지 오늘 안에 정해서 알려줘. 우리 둘 다 서명한 키프 증서에 있는 약속이야.` },
      { label: '분명하게', text: `${s} 약속, 더 미루기는 어려워. ${nd}까지 연락 없으면 정식으로 이행 촉구서 보낼게.` }],
  };
  return (hon ? H : B)[band];
}

/** 이행 촉구서 초안 (D+14) */
export function noticeText(p: Pick<PromiseDoc, 'tpl' | 'amount' | 'item' | 'task' | 'aName' | 'bName' | 'deadline' | 'method' | 'penalty' | 'amendments' | 'currentHash'> & { bSignedAt?: string }, nudgeCount: number, today: string): string {
  const due = addDays(today, 7), s = subjectText(p);
  return `이행 촉구서

수신: ${p.bName}
발신: ${p.aName}

1. 약속 내용
${p.bName}${pp(p.bName, '은', '는')} ${p.bSignedAt ? korDate(p.bSignedAt.slice(0, 10)) + ' ' : ''}키프 약속증서(확인코드 ${shortCode(p.currentHash)})에 서명하여, ${korDate(p.deadline)}까지 ${TPL[p.tpl].what} ${s}${p.amount ? '(금 ' + hangulAmount(p.amount) + '원정)' : ''}${pp(s, '을', '를')} ${p.method || '약속한 방법'}으로 이행하기로 약속하였습니다.${p.penalty ? `\n또한 어겼을 때 "${p.penalty}"하기로 하였습니다.` : ''}

2. 경과
기한이 지난 뒤 ${nudgeCount}차례 이행을 요청하였으나 오늘(${korDate(today)})까지 이행되지 않았습니다.${(p.amendments || []).length ? `\n그사이 다음과 같이 약속을 변경하였습니다: ${p.amendments.map((a) => a.text).join(' / ')}` : ''}

3. 요청 사항
${korDate(due)}까지 위 약속을 이행해 주시기 바랍니다. 사정이 있으면 그 전에 연락해 주시면 일정을 다시 협의하겠습니다.

4. 참고
기한까지 이행되지 않으면 지급명령이나 소액사건심판 등 법적 절차를 검토할 수 있습니다. 증서와 대화·송금 기록은 보관하고 있습니다.

${korDate(today)}
발신인 ${p.aName}

※ 본 문서는 당사자 간 약속 기록을 바탕으로 작성한 안내문이며 법률 자문이 아닙니다.`;
}

// ---------------- 금지어 (욕설·협박·과장된 법적 위협) ----------------
const BANNED: { re: RegExp; why: string }[] = [
  { re: /씨\s*발|시\s*발|ㅅ\s*ㅂ|ㅆ\s*ㅂ|씨\s*팔|병\s*신|ㅂ\s*ㅅ|개\s*새|개\s*세\s*끼|새\s*끼|좆|존\s*나|졸\s*라|미\s*친\s*(놈|년|새)|지\s*랄|꺼\s*져|닥\s*쳐|엿\s*먹/, why: '욕설' },
  { re: /죽여|죽인다|죽을\s*줄|가만\s*안\s*(둬|둔다|둘)|두고\s*봐|찾아\s*(간다|갈게|가서|갈\s*거)|집\s*(으)?로\s*찾아|(회사|직장|학교|과\s*사무실)\s*(에|에다|로|한테)\s*(다\s*)?(알리|알릴|알려|찾아|연락|말할|말해|뿌릴)|(부모님?|엄마|아빠|가족)\s*(께|한테|에게)\s*(다\s*)?(알리|알릴|알려|말하|말할|말해|연락)|신상\s*(공개|털)|박제\s*(할|한다|해|하겠)|망신\s*(줄|주겠|당하)|(sns|인스타|에브리타임|에타|단톡)\S*\s*(에|에다)\s*(올릴|올린다|올리겠|뿌릴)/i, why: '협박' },
  { re: /고소\s*(하겠|할게|한다|할\s*거)|형사\s*(고소|처벌)|사기\s*죄|구속|감옥|경찰\s*(에|에게)?\s*신고|압류\s*(하겠|할게|한다)|강제\s*집행\s*(하겠|할게|한다)|법적\s*책임을\s*묻|소송\s*(걸|하겠|할게)/, why: '과장된 법적 위협' },
];
export function checkBanned(text: string): string | null {
  for (const b of BANNED) if (b.re.test(text)) return b.why;
  return null;
}

// ---------------- 야간 발송 금지 (21시~다음 날 9시 KST) ----------------
export const QUIET_START = 21, QUIET_END = 9;
/** 지금 보내도 되면 now, 아니면 다음 오전 9시(KST) */
export function nextSendTime(now: Date): Date {
  const h = kstHour(now);
  if (h >= QUIET_END && h < QUIET_START) return now;
  const kst = new Date(now.getTime() + 9 * 3600e3);
  const base = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), QUIET_END) - 9 * 3600e3;
  return new Date(h >= QUIET_START ? base + 864e5 : base);
}
