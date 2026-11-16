// 증거 묶음 PDF: 한글 폰트를 넣어 만들고, 다시 열어 쪽수·메타데이터·폰트 내장을 확인
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildEvidencePdf, plain } from '../../src/lib/evidencePdf.ts';
import { jcs, sha256Hex } from '../../supabase/functions/_shared/domain/canonical.ts';

const fonts = {
  serif: new Uint8Array(readFileSync('public/fonts/KeepSerif-Regular.ttf')),
  sans: new Uint8Array(readFileSync('public/fonts/KeepSans-Regular.ttf')),
};
// 1×1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function events(n: number) {
  const out = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const canon = jcs({ i, note: '증거 기록 ' + i });
    const at = new Date(Date.UTC(2026, 10, 16, 1, i)).toISOString();
    const hash = await sha256Hex((prev || '') + canon + at);
    out.push({ id: i + 1, promise_id: 'p', actor_role: i % 2 ? 'B' as const : 'A' as const, type: i === 0 ? 'created' : 'signed', payload: JSON.parse(canon), canon, created_at: at, sim_at: null, prev_hash: prev, hash });
    prev = hash;
  }
  return out;
}

describe('증거 묶음 PDF', () => {
  it('한글 증서·서명·해시 체인·캡처를 담고, 한글 폰트를 내장한다', async () => {
    const bytes = await buildEvidencePdf({
      doc: { id: 'x', code: 'K7MX2QPA', tpl: 'loan', title: '민수 월세 30만원', aName: '박제훈', bName: '김민수', amount: 300000, interestRate: 5, lateInterestRate: null, repayAccount: '국민 123-456-789012', item: '', task: '', deadline: '2026-12-15', method: '계좌이체', penalty: '늦으면 밥 한 번 사기', memo: '', installments: [], amendments: [{ at: '2026-11-20T01:00:00.000Z', text: '기한을 2026년 12월 15일에서 12월 22일로 연장' }], sigA: { at: '2026-11-16T01:00:00.000Z', sha: 'a'.repeat(64) }, sigB: { at: '2026-11-16T02:00:00.000Z', sha: 'b'.repeat(64) }, createdAt: '2026-11-16T01:00:00.000Z', currentHash: 'c'.repeat(64) },
      parties: [
        { role: 'A', name: '박제훈', signedAt: '2026-11-16T01:00:00.000Z', ip: '203.0.113.7', ua: 'iPhone KAKAOTALK', consentAt: '2026-11-16T01:00:00.000Z', sha: 'a'.repeat(64) },
        { role: 'B', name: '김민수', signedAt: '2026-11-16T02:00:00.000Z', ip: '198.51.100.2', ua: 'Android Chrome', consentAt: '2026-11-16T02:00:00.000Z', sha: 'b'.repeat(64) },
      ],
      sigs: { A: [[10, 10, 60, 40, 120, 15]], B: [[20, 40, 80, 10, 150, 45]] },
      events: await events(40),
      chainOk: true,
      proofs: [{ bytes: PNG, mime: 'image/png', caption: '송금 완료 캡처 · 300,000원' }],
      generatedAt: new Date('2026-11-25T03:00:00Z'),
    }, fonts);
    expect(bytes.length).toBeLessThan(2_500_000); // 폰트 2종 내장(압축) 포함
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(3); // 증서 + 기록 40건 + 캡처 쪽
    expect(pdf.getTitle()).toBe('키프 증거 묶음 · 민수 월세 30만원');
    const fontsInDoc = pdf.context.enumerateIndirectObjects().filter(([, o]) => (o as { get?: (k: PDFName) => unknown }).get?.(PDFName.of('Type')) === PDFName.of('Font'));
    expect(fontsInDoc.length).toBeGreaterThanOrEqual(2);
  });
  it('HTML 조각을 평문으로', () => {
    expect(plain('<b data-f="a">김&amp;민수</b>는<br>&lt;확인&gt;')).toBe('김&민수는\n<확인>');
  });
});
