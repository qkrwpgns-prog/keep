// 예시 대화 5종 (시연·AI 평가·규칙 대체 경로 테스트에 함께 쓴다)
import type { TemplateKey } from './templates.ts';
import { EXAMPLE_CHAT } from './templates.ts';

export interface ExampleChat { key: string; label: string; tpl: TemplateKey; myName: string; text: string }

export const EXAMPLES: ExampleChat[] = [
  { key: 'loan', label: '돈 빌려주기', tpl: 'loan', myName: '박제훈', text: EXAMPLE_CHAT },
  {
    key: 'lend', label: '물건 대여', tpl: 'lend', myName: '이서연', text: `[카카오톡 대화]
김하늘: 서연아 혹시 닌텐도 스위치 좀 빌릴 수 있어? 동생 생일이라ㅠ
나: 응 빌려줄게! 케이스랑 충전기도 같이 줄게
김하늘: 고마워!! 다음 주 금요일에 학교에서 직접 돌려줄게
나: 오케이 대신 기스 나면 안돼ㅋㅋ
김하늘: 망가뜨리면 내가 수리비 낼게`,
  },
  {
    key: 'team', label: '조별과제 역할', tpl: 'team', myName: '정우진', text: `[카카오톡 단톡방 - 멀티모달콘텐츠 4조]
나: 그럼 역할 정리할게. 자료조사는 내가, 발표자료는 수빈이가 맡는 걸로
최수빈: 응 발표 자료 PPT 10장 내외로 내가 만들게
나: 12월 3일 수요일까지 단톡방에 올려줄 수 있어?
최수빈: 그날 밤 10시까지 구글드라이브에 올려둘게!
나: 좋아 늦으면 커피 한 잔 사기ㅋㅋ`,
  },
  {
    key: 'split', label: '여행 경비 정산', tpl: 'split', myName: '한지민', text: `[카카오톡 대화]
나: 부산 여행 숙소비 내가 먼저 결제했어. 총 24만원이니까 1인당 8만원!
오태양: 오 고마워 내 몫 8만원 토스로 보낼게
나: 이번 달 말까지만 보내줘~
오태양: 알바비 들어오면 바로 보낼게 25일쯤?`,
  },
  {
    key: 'vague', label: '모호한 대화', tpl: 'pledge', myName: '윤도현', text: `[카카오톡 대화]
윤재: 형 저번에 그거 미안해요
나: 아 그거? 괜찮아 근데 언젠가는 해줘야 한다
윤재: 네네 조만간 꼭 할게요ㅎㅎ
나: 말만 하지 말고ㅋㅋ`,
  },
];
