import type { PromiseStatus, TemplateKey } from './templates.ts';

/** 손글씨 서명 획: [x1,y1,x2,y2,...] 배열의 배열 (200×60 좌표계) */
export type SigVector = number[][];
/** 화면·PDF에 그릴 서명: 손글씨 획 또는 이름 입력 서명 */
export type SigShown = SigVector | { typed: string };

export interface Installment {
  amount: number;
  date: string;
  paid?: boolean;
}
export interface Amendment {
  at: string; // ISO
  text: string;
}
export interface SigMeta {
  at: string; // ISO (서버 시각)
  sha: string; // 서명 파일 SHA-256
}

/** 증서와 화면이 함께 쓰는 약속 문서 (DB 행을 camelCase로 옮긴 것) */
export interface PromiseDoc {
  id: string;
  code: string; // share_code
  tpl: TemplateKey;
  title: string;
  aName: string;
  bName: string;
  amount: number | null;
  interestRate: number | null;
  lateInterestRate: number | null;
  repayAccount: string;
  item: string;
  task: string;
  deadline: string;
  method: string;
  penalty: string;
  memo: string;
  installments: Installment[];
  amendments: Amendment[];
  sigA: SigMeta | null;
  sigB: SigMeta | null;
  status: PromiseStatus;
  currentHash: string;
  createdAt: string;
  version: number;
  isDemo: boolean;
  deadlineVersion: number;
  /** 시연 약속의 되감은 날짜(기한 기준 일수). null이면 실제 오늘 */
  demoOffset: number | null;
  /** 여러 명 정산으로 함께 만든 약속 묶음 */
  groupId: string | null;
}

/** 작성 화면에서 채우는 필드 */
export interface DraftFields {
  title: string;
  aName: string;
  bName: string;
  amount: string;
  interestRate: string;
  lateInterestRate: string;
  repayAccount: string;
  item: string;
  task: string;
  deadline: string;
  method: string;
  penalty: string;
  memo: string;
  /** 상대 지정 이메일(선택) */
  bEmail: string;
}

export const emptyFields = (): DraftFields => ({
  title: '', aName: '', bName: '', amount: '', interestRate: '', lateInterestRate: '', repayAccount: '',
  item: '', task: '', deadline: '', method: '', penalty: '', memo: '', bEmail: '',
});
