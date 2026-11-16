import type { SigVector } from '@domain/types.ts';

const cache = new Map<string, string>();
/** 서명 벡터(200×60) → PNG data URL */
export function sigImg(sv: SigVector | null | undefined): string {
  if (!sv) return '';
  const k = JSON.stringify(sv);
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 120;
  const x = c.getContext('2d')!;
  x.scale(2, 2); x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1f1b2d'; x.lineWidth = 1.9;
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
