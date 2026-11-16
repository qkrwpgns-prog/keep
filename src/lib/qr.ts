import qrcode from 'qrcode-generator';

/** 짧은 주소만 담으므로 버전이 낮아 칸이 성기다(스캔이 쉬움) */
export function qrSVG(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): string {
  try {
    const q = qrcode(0, ecc);
    q.addData(text, 'Byte');
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch {
    return '';
  }
}
