// 법·윤리 가드레일: 이자제한법 최고이자율, 반복 이자 차용증 안내

/** 이자제한법 시행령상 최고이자율(연 %) */
export const MAX_INTEREST_RATE = 20;
/** 원금 10만 원 미만은 이자제한법 상한 규정이 적용되지 않음 */
export const INTEREST_CAP_MIN_PRINCIPAL = 100_000;
/** 최근 90일 안에 이자 있는 차용증을 이 개수 이상 만들면 대부업 안내 */
export const REPEAT_INTEREST_LOAN_THRESHOLD = 3;
export const REPEAT_WINDOW_DAYS = 90;

export interface RateCheck {
  ok: boolean;
  error?: string;
  notice?: string;
}

export function parseRate(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** 이자율·연체이자율 입력 검사 */
export function checkRates(input: { amount: number | null; interestRate: number | null; lateInterestRate: number | null }): RateCheck {
  const { amount, interestRate, lateInterestRate } = input;
  for (const [label, r] of [['이자율', interestRate], ['연체이자율', lateInterestRate]] as const) {
    if (r === null) continue;
    if (r < 0) return { ok: false, error: `${label}은 0% 이상이어야 해요.` };
    if (r > MAX_INTEREST_RATE) return { ok: false, error: `${label}은 연 ${MAX_INTEREST_RATE}%를 넘을 수 없어요(이자제한법 최고이자율).` };
  }
  if ((interestRate ?? 0) > 0 || (lateInterestRate ?? 0) > 0) {
    if (amount !== null && amount < INTEREST_CAP_MIN_PRINCIPAL) {
      return { ok: true, notice: '원금이 10만 원 미만이면 이자제한법의 최고이자율 규정이 적용되지 않아요. 그래도 키프는 연 20%까지만 입력할 수 있어요.' };
    }
  }
  return { ok: true };
}

export const REPEAT_LOAN_NOTICE =
  '이자를 받는 차용증을 여러 번 반복해서 만들고 있어요. 이자를 받으며 돈을 빌려주는 일을 계속·반복하면 미등록 대부업으로 볼 위험이 있으니 주의하세요. 필요하면 대한법률구조공단(국번 없이 132)에 상담하세요.';
