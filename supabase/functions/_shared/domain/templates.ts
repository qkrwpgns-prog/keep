// 증서 템플릿·단계·상태 정의 (legacy/index.html의 TPL·STAGES·STATUS 이식)

export type TemplateKey = 'loan' | 'lend' | 'pledge' | 'team' | 'split';
export type TemplateKind = 'money' | 'item' | 'task';

export interface Template {
  name: string;
  kind: TemplateKind;
  desc: string;
  a: string;
  b: string;
  what: string;
  due: string;
  how: string;
}

export const TPL: Record<TemplateKey, Template> = {
  loan: { name: '금전 차용증', kind: 'money', desc: '돈을 빌려주고 받을 때', a: '빌려준 사람', b: '빌린 사람', what: '빌린 금액', due: '갚을 날', how: '갚는 방법' },
  lend: { name: '물건 대여 확인서', kind: 'item', desc: '물건을 빌려줄 때', a: '빌려준 사람', b: '빌린 사람', what: '빌린 물건', due: '돌려줄 날', how: '돌려주는 방법' },
  pledge: { name: '약속 이행 각서', kind: 'task', desc: '해야 할 일을 약속할 때', a: '약속받는 사람', b: '약속한 사람', what: '약속 내용', due: '지킬 날', how: '지키는 방법' },
  team: { name: '역할 분담 합의서', kind: 'task', desc: '조별과제·공동 작업', a: '요청한 사람', b: '맡은 사람', what: '맡은 역할', due: '완료 기한', how: '결과 공유 방법' },
  split: { name: '경비 정산 확인서', kind: 'money', desc: '여행·모임 비용 나누기', a: '먼저 낸 사람', b: '정산할 사람', what: '정산 금액', due: '정산할 날', how: '정산 방법' },
};

export const TEMPLATE_KEYS = Object.keys(TPL) as TemplateKey[];
export const isTemplateKey = (k: unknown): k is TemplateKey => typeof k === 'string' && k in TPL;

export const STAGES = [
  { n: 1, name: '사전 알림', label: 'D-3' },
  { n: 2, name: '당일 알림', label: 'D-day' },
  { n: 3, name: '1차 재촉', label: 'D+3' },
  { n: 4, name: '2차 재촉', label: 'D+7' },
  { n: 5, name: '공식 통지', label: 'D+14' },
] as const;

export type PromiseStatus = 'draft' | 'pending_b' | 'revise' | 'active' | 'reported' | 'done' | 'cancelled' | 'declined';

export const STATUS: Record<PromiseStatus, { t: string; c: string }> = {
  draft: { t: '작성 중', c: '' },
  pending_b: { t: '서명 대기', c: 'blue' },
  revise: { t: '수정 요청됨', c: 'warn' },
  active: { t: '진행 중', c: '' },
  reported: { t: '이행 확인 대기', c: 'blue' },
  done: { t: '지킴 완료', c: 'ok' },
  cancelled: { t: '취소됨', c: '' },
  declined: { t: '서명 거절됨', c: 'warn' },
};

export const TONES = ['', '아주 친근', '친근', '정중', '단호', '매우 단호'];
export const RELATIONS = ['친구', '후배', '조원', '가족', '선배', '지인'] as const;

export const EXAMPLE_CHAT = `[카카오톡 대화]
민수: 제훈아 진짜 미안한데 30만원만 빌려줄 수 있어? 이번 달 월세가 모자라서ㅠ
나: 음.. 언제까지 갚을 수 있는데?
민수: 다음 달 15일에 알바비 들어오면 바로 계좌로 보낼게!
나: 오케이 그럼 다음 달 15일까지 계좌이체로 꼭 줘
민수: 고마워 진짜 꼭 갚을게. 늦으면 밥 한 번 살게ㅋㅋ`;

export const DISCLAIMER = '키프는 약속의 증거를 남기고 이행을 돕는 도구입니다. 법률 자문이 아니며, 증서는 공증·강제집행력이 있는 문서가 아닙니다.';
