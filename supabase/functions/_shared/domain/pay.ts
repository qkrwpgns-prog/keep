// 송금 바로가기: 공식 개인 송금 링크만 쓴다(사업자 연동·비공식 앱 주소 없음)
//  · 토스 아이디: https://toss.me/{아이디}/{금액}
//  · 카카오페이 송금 링크: https://qr.kakaopay.com/{코드} (금액은 받는 쪽 앱에서 입력)
export const TOSS_ID_RE = /^[A-Za-z0-9_.-]{2,30}$/;
export const KAKAO_URL_RE = /^https:\/\/qr\.kakaopay\.com\/[A-Za-z0-9]{4,60}$/;

/** 사용자가 붙여넣은 값 정리: 'toss.me/abc' 'https://toss.me/abc/' '@abc' → 'abc' */
export function cleanTossId(v: string): string | null {
  const s = v.trim().replace(/^https?:\/\//, '').replace(/^toss\.me\//, '').replace(/^@/, '').replace(/\/.*$/, '');
  return s ? (TOSS_ID_RE.test(s) ? s : null) : '';
}
/** 'qr.kakaopay.com/Ej7…' 'https://qr.kakaopay.com/Ej7…?x' → 정규 주소 */
export function cleanKakaoUrl(v: string): string | null {
  const s = v.trim();
  if (!s) return '';
  const m = s.match(/^(?:https?:\/\/)?qr\.kakaopay\.com\/([A-Za-z0-9]{4,60})(?:[/?#].*)?$/);
  return m ? `https://qr.kakaopay.com/${m[1]}` : null;
}

export const tossUrl = (id: string, amount: number | null | undefined) =>
  `https://toss.me/${encodeURIComponent(id)}${amount && amount > 0 ? '/' + Math.floor(amount) : ''}`;

/** 계좌 문자열에서 복사용 숫자만(은행명은 그대로 두고 하이픈 유지) */
export const accountForCopy = (acc: string) => acc.trim().replace(/\s+/g, ' ');
