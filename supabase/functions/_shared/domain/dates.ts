// 날짜 함수. 실행 환경의 시간대와 상관없이 같은 결과가 나오도록
// 'YYYY-MM-DD' 문자열과 UTC 산술만 쓰고, "오늘"은 KST(UTC+9)로 계산한다.

const KST_OFFSET_MS = 9 * 3600 * 1000;
export const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC 기준 Date → 'YYYY-MM-DD' */
export const ymdUTC = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
export const isYmd = (s: unknown): s is string => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
/** 'YYYY-MM-DD' → 해당 날짜 00:00 UTC */
export const parseYmd = (s: string) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
/** 연·월(0부터)·일 → 'YYYY-MM-DD' (월·일 넘침은 자동 보정, 일=0이면 전달 말일) */
export const mkYmd = (y: number, m: number, d: number) => ymdUTC(new Date(Date.UTC(y, m, d)));
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdUTC(d);
};
export const diffDays = (a: string, b: string) => Math.round((parseYmd(a).getTime() - parseYmd(b).getTime()) / 864e5);

/** 주어진 시각의 KST 날짜 */
export const kstYmd = (t: number | Date = Date.now()) => ymdUTC(new Date(+t + KST_OFFSET_MS));
export const kstToday = (now: number | Date = Date.now()) => kstYmd(now);
/** KST 시(0~23) */
export const kstHour = (t: number | Date = Date.now()) => new Date(+t + KST_OFFSET_MS).getUTCHours();

export const korDate = (s: string | null | undefined) => {
  if (!isYmd(s)) return '미정';
  const d = parseYmd(s);
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
export const shortDate = (s: string | null | undefined) => {
  if (!isYmd(s)) return '미정';
  const d = parseYmd(s);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
/** 타임스탬프(ms 또는 ISO) → 'YYYY.MM.DD HH:mm' (KST) */
export const stamp = (t: number | string | Date) => {
  const d = new Date(new Date(t).getTime() + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}.${pad2(d.getUTCMonth() + 1)}.${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
};

export const ddayLabel = (today: string, deadline: string | null | undefined) => {
  if (!isYmd(deadline)) return '';
  const x = diffDays(today, deadline);
  return x < 0 ? `D-${-x}` : x === 0 ? 'D-day' : `D+${x}`;
};
/** 기한 대비 경과일 → 재촉 단계(0=해당 없음, 1~5) */
export const stageOf = (x: number) => (x >= 14 ? 5 : x >= 7 ? 4 : x >= 3 ? 3 : x >= 0 ? 2 : x >= -3 ? 1 : 0);
