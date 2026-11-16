// 금액·조사·이름 처리 (legacy 이식) + 개인정보 가림

export const won = (n: number | string | null | undefined) =>
  n == null || n === '' || isNaN(Number(n)) ? '' : Number(n).toLocaleString('ko-KR') + '원';

/** 300000 → '삼십만' (증서의 '금 ○○원정' 표기용) */
export function hangulAmount(input: number | string | null | undefined): string {
  let n = Math.floor(Number(input));
  if (!n || n < 0) return '';
  const d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const u = ['', '십', '백', '천'];
  const b = ['', '만', '억', '조'];
  let s = '';
  let i = 0;
  while (n > 0) {
    const c = n % 10000;
    if (c) {
      const ds = String(c).padStart(4, '0');
      let t = '';
      for (let k = 0; k < 4; k++) {
        const v = +ds[k];
        if (v) t += d[v] + u[3 - k];
      }
      s = t + b[i] + s;
    }
    n = Math.floor(n / 10000);
    i++;
  }
  return s;
}

/** 마지막 글자 받침 여부. 한글이 아니면 null */
export const hasJong = (w: string | null | undefined): boolean | null => {
  const c = String(w || '').trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 > 0 : null;
};
/** 조사 자동 처리: pp('민수','은','는') → '는' */
export const pp = (w: string | null | undefined, a: string, b: string) => {
  const j = hasJong(w);
  return j === null ? a + '(' + b + ')' : j ? a : b;
};
/** '김민수' → '민수야', '지훈' → '지훈아' */
export const callName = (n: string | null | undefined) => {
  const s = String(n || '').trim();
  const g = s.length === 3 ? s.slice(1) : s;
  return g + (hasJong(g) ? '아' : '야');
};
export const clip = (s: string | null | undefined, n: number) => {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/** '김민수' → '김*수', '민수' → '민*' (로그인 전 미리보기용) */
export const maskName = (n: string | null | undefined) => {
  const s = String(n || '').trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '*';
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1];
};
/** '국민 123-456-789012' → '국민 123-***-**9012' 처럼 숫자 가운데를 가림 */
export const maskAccount = (s: string | null | undefined) => {
  const t = String(s || '');
  const digits = t.replace(/\D/g, '');
  if (digits.length < 6) return t;
  let seen = 0;
  return t.replace(/\d/g, (ch) => {
    seen++;
    return seen <= 3 || seen > digits.length - 4 ? ch : '*';
  });
};
/** 문장 속 전화번호 가림: 010-1234-5678 → 010-****-5678 */
export const maskPhones = (s: string) => s.replace(/(01[016789])[-\s.]?(\d{3,4})[-\s.]?(\d{4})/g, (_m, a, _b, c) => `${a}-****-${c}`);
