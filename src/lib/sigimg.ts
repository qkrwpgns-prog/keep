import type { SigShown } from '@domain/types.ts';

const cache = new Map<string, string>();
/** 서명(200×60 획 벡터 또는 이름 입력) → PNG data URL */
export function sigImg(sv: SigShown | null | undefined): string {
  if (!sv) return '';
  const k = JSON.stringify(sv);
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 120;
  const x = c.getContext('2d')!;
  x.scale(2, 2); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1f1b2d'; x.lineWidth = 1.9;
  if (!Array.isArray(sv)) {
    // 이름 입력 서명: 이름을 크게, 아래에 방식 표시
    x.fillStyle = '#1f1b2d'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let size = 26;
    x.font = `700 ${size}px 'Nanum Myeongjo', 'KeepSerif', serif`;
    while (x.measureText(sv.typed).width > 180 && size > 12) { size -= 2; x.font = `700 ${size}px 'Nanum Myeongjo', 'KeepSerif', serif`; }
    x.fillText(sv.typed, 100, 26);
    x.font = "500 8px sans-serif"; x.fillStyle = '#8b8597'; x.fillText('이름 입력 서명', 100, 52);
    const url = c.toDataURL('image/png');
    cache.set(k, url);
    return url;
  }
  sv.forEach((s) => {
    x.beginPath();
    for (let i = 0; i < s.length; i += 2) {
      if (i) x.lineTo(s[i], s[i + 1]);
      else x.moveTo(s[i], s[i + 1]);
    }
    if (s.length === 2) x.lineTo(s[0] + 0.3, s[1]);
    x.stroke();
  });
  const url = c.toDataURL('image/png');
  cache.set(k, url);
  return url;
}
