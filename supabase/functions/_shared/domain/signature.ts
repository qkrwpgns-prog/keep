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

/** 이름 입력 서명(손으로 쓰기 어려운 사람용): 증서에 적힌 이름과 띄어쓰기만 빼고 같아야 한다 */
export const normName = (s: string) => s.normalize('NFC').replace(/\s+/g, '');
export function typedName(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const t = (v as { typed?: unknown }).typed;
  if (typeof t !== 'string') return null;
  const s = t.normalize('NFC').trim().replace(/\s+/g, ' ');
  return s && s.length <= 40 ? s : null;
}
export async function typedSignatureFile(name: string): Promise<{ body: string; sha: string }> {
  const body = jcs({ v: 1, kind: 'typed', name, w: 200, h: 60, strokes: [] });
  return { body, sha: await sha256Hex(body) };
}

/** 저장 파일 내용(정규화 JSON)과 그 SHA-256 */
export async function signatureFile(v: SigVector): Promise<{ body: string; sha: string }> {
  const body = jcs({ v: 1, w: 200, h: 60, strokes: v });
  return { body, sha: await sha256Hex(body) };
}

/** 시연용 손글씨 서명(획 벡터) */
export const DEMO_SIG: SigVector = [[18, 38, 30, 16, 40, 40, 52, 18, 62, 42, 78, 20], [88, 36, 104, 22, 118, 34, 132, 24, 150, 38, 176, 26]];
