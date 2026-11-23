// 증거 묶음 PDF: 한글 폰트를 넣어 만들고, 다시 열어 쪽수·메타데이터·폰트 내장을 확인
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildEcourtFiles, buildEvidencePdf, buildReceiptPdf, plain } from '../../src/lib/evidencePdf.ts';
import { ecourtPlan } from '../../supabase/functions/_shared/domain/ecourt.ts';
import { unzipSync, zipSync } from 'fflate';
import { receiptText } from '../../supabase/functions/_shared/domain/receipt.ts';
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
      sigs: { A: [[10, 10, 60, 40, 120, 15]], B: { typed: '김민수' } },
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

const RDOC = { code: 'K7MX2QPA', tpl: 'loan' as const, title: '민수 월세 30만원', aName: '박제훈', bName: '김민수', amount: 300000, interestRate: null, lateInterestRate: null, repayAccount: '', item: '', task: '', deadline: '2026-12-15', method: '계좌이체', penalty: '', memo: '', installments: [], amendments: [], sigA: null, sigB: null, createdAt: '2026-11-16T01:00:00.000Z', currentHash: 'c'.repeat(64) };
const RPAY = [
  { amount: 100000, paid_on: '2026-11-30', installment_no: 0, created_at: '2026-11-30T03:00:00Z' },
  { amount: 200000, paid_on: null, installment_no: 1, created_at: '2026-12-10T03:00:00Z' },
];

describe('변제 완료 확인서', () => {
  it('종류별 제목·문구, 상환 내역과 합계', () => {
    const r = receiptText(RDOC, RPAY, '2026-12-10T05:00:00Z');
    expect(r.title).toBe('변제 완료 확인서');
    expect(r.lead).toBe('박제훈(빌려준 사람)은 김민수(빌린 사람)으로부터 2026. 11. 16. 작성한 금전 차용증(증서번호 K7MX2QPA)에 따른 금 삼십만원정(300,000원) 전액을 변제받았음을 확인합니다.');
    expect(r.payments).toEqual([['2026년 11월 30일', '100,000원', '1회차'], ['2026년 12월 10일', '200,000원', '2회차']]);
    expect(r.paidTotal).toBe(300000);
    expect(r.rows.find(([k]) => k === '완료 확인')![1]).toBe('2026.12.10 14:00 (KST, 서버 시각)');
    expect(receiptText({ ...RDOC, tpl: 'lend', amount: null, item: '닌텐도 스위치' }, [], '2026-12-10T05:00:00Z').lead).toContain('빌려준 물건(닌텐도 스위치)을 돌려받았음');
    expect(receiptText({ ...RDOC, tpl: 'team', amount: null, task: 'PPT 제작' }, [], '2026-12-10T05:00:00Z').title).toBe('이행 완료 확인서');
    expect(receiptText(RDOC, [], '2026-12-10T05:00:00Z').rows.some(([k]) => k === '상환 기록')).toBe(true);
  });
  it('PDF로 만들 수 있다', async () => {
    const bytes = await buildReceiptPdf({ doc: RDOC, payments: RPAY, done: { at: '2026-12-10T05:00:00Z', hash: 'd'.repeat(64) }, chainOk: true, generatedAt: new Date('2026-12-11T00:00:00Z') }, fonts);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe('키프 변제 완료 확인서 · 민수 월세 30만원');
  });
});

describe('전자소송 제출용 묶음', () => {
  const doc = { ...RDOC, status: 'active' as const, deadline: '2026-11-10', lateInterestRate: 12, interestRate: null, currentHash: 'c'.repeat(64), id: 'x' };
  const evs = [
    { type: 'created', created_at: '2026-11-01T01:00:00Z' },
    { type: 'nudge_sent', created_at: '2026-11-13T01:00:00Z', payload: { text: '민수야 확인 부탁해' } },
    { type: 'notice_sent', created_at: '2026-11-24T01:00:00Z', payload: { text: '이행 촉구서 …' } },
  ];
  const pays = [{ amount: 100000, confirmed_by_a: true }, { amount: 50000, confirmed_by_a: null }];
  const plan = ecourtPlan(doc, evs, pays, 2, '2026-11-25');
  it('호증 번호·파일 이름·입증취지', () => {
    expect(plan.items.map((x) => x.no)).toEqual(['갑 제1호증', '갑 제2호증', '갑 제3호증', '갑 제4호증의1', '갑 제4호증의2']);
    expect(plan.items[0]).toMatchObject({ file: '갑제1호증_금전차용증.pdf', purpose: '김민수가 박제훈으로부터 300,000원을 빌리고 2026. 11. 10.까지 갚기로 약정한 사실' });
    expect(plan.items[2].purpose).toContain('2026. 11. 13., 2026. 11. 24.');
    expect(plan.summary).toContainEqual(['남은 금액(청구 검토 금액)', '200,000원']);
    expect(plan.summary).toContainEqual(['기한 경과', '15일 (2026. 11. 25. 기준)']);
    expect(plan.summary).toContainEqual(['약정 연체이자', '연 12%']);
    expect(plan.notes.join(' ')).toContain('법률 자문이 아닙니다');
  });
  it('재촉·캡처가 없으면 그 호증은 빠진다', () => {
    expect(ecourtPlan(doc, evs.slice(0, 1), [], 0, '2026-11-25').items.map((x) => x.no)).toEqual(['갑 제1호증', '갑 제2호증']);
  });
  it('파일을 만들어 ZIP으로 묶을 수 있다', async () => {
    const files = await buildEcourtFiles({
      doc, parties: [{ role: 'A', name: '박제훈', signedAt: '2026-11-01T01:00:00Z', ip: null, ua: null, consentAt: null, sha: 'a'.repeat(64) }, { role: 'B', name: '김민수', signedAt: '2026-11-01T02:00:00Z', ip: null, ua: null, consentAt: null, sha: 'b'.repeat(64) }],
      sigs: { A: [[10, 10, 60, 40]], B: { typed: '김민수' } }, events: await events(5), chainOk: true,
      proofs: [{ bytes: PNG, mime: 'image/png', caption: '캡처 1' }, { bytes: PNG, mime: 'image/png', caption: '캡처 2' }], generatedAt: new Date('2026-11-25T03:00:00Z'),
    }, plan, fonts);
    expect(files.map((f) => f.name)).toEqual(['00_증거목록.pdf', '갑제1호증_금전차용증.pdf', '갑제2호증_전자서명및기록.pdf', '갑제3호증_이행촉구기록.pdf', '갑제4호증의1_송금캡처.pdf', '갑제4호증의2_송금캡처.pdf', '참고_청구내용정리.pdf']);
    for (const f of files) expect((await PDFDocument.load(f.bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    const zip = zipSync(Object.fromEntries(files.map((f) => [f.name, f.bytes])));
    expect(Object.keys(unzipSync(zip))).toHaveLength(7);
  }, 60000);
});
