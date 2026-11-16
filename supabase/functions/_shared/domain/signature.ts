// 손글씨 서명 벡터 처리 (legacy rdp·padVector 이식)
import type { SigVector } from './types.ts';
import { jcs, sha256Hex } from './canonical.ts';

type Pt = [number, number];

/** Ramer–Douglas–Peucker 단순화 */
export function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  let idx = 0, max = 0;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  return [pts[0], pts[pts.length - 1]];
}

/** 캔버스(560×170) 좌표 획 → 200×60 정수 벡터. 점이 너무 적으면 null */
export function strokesToVector(strokes: Pt[][], w = 560, h = 170): SigVector | null {
  const out = strokes
    .filter((s) => s.length)
    .map((s) => rdp(s.map(([x, y]) => [x * 200 / w, y * 60 / h] as Pt), 1.0).flatMap(([x, y]) => [Math.round(x), Math.round(y)]));
  const pts = out.reduce((n, s) => n + s.length / 2, 0);
  return pts >= 4 ? out : null;
}

/** 서버 검증: 모양·크기·좌표 범위 */
export function validateVector(v: unknown): v is SigVector {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200) return false;
  let pts = 0;
  for (const s of v) {
    if (!Array.isArray(s) || s.length < 2 || s.length % 2 !== 0 || s.length > 4000) return false;
    for (const n of s) if (!Number.isInteger(n) || n < -20 || n > 260) return false;
    pts += s.length / 2;
  }
  return pts >= 4;
}

/** 저장 파일 내용(정규화 JSON)과 그 SHA-256 */
export async function signatureFile(v: SigVector): Promise<{ body: string; sha: string }> {
  const body = jcs({ v: 1, w: 200, h: 60, strokes: v });
  return { body, sha: await sha256Hex(body) };
}
