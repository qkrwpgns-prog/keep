// 증거 묶음 PDF: 증서 · 서명 메타데이터 · 이벤트 해시 체인 · 첨부 캡처
// pdf-lib + fontkit로 한글 폰트(나눔명조·나눔고딕에서 파생한 Keep Serif/Sans, OFL)를 내장한다.
// pdf-lib의 부분 내장(subset)은 한글 글자를 일부 빠뜨려서, 미리 줄여 둔 폰트를 통째로 넣는다(PDF 약 1MB).
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { certBody, type CertDoc } from '@domain/certificate.ts';
import { TPL, DISCLAIMER } from '@domain/templates.ts';
import { stamp } from '@domain/dates.ts';
import { shortCode } from '@domain/canonical.ts';
import { eventText, type EventRow } from '@domain/events.ts';
import type { SigShown } from '@domain/types.ts';
import { receiptText, type ReceiptPayment } from '@domain/receipt.ts';
import { won } from '@domain/korean.ts';
import type { EcourtPlan } from '@domain/ecourt.ts';

export interface PartyMeta { role: 'A' | 'B'; name: string; signedAt: string | null; ip: string | null; ua: string | null; consentAt: string | null; sha: string | null }
export interface ProofImage { bytes: Uint8Array; mime: string; caption: string }
export interface EvidenceInput {
  doc: CertDoc & { currentHash: string; id: string };
  parties: PartyMeta[];
  sigs: { A: SigShown | null; B: SigShown | null };
  events: EventRow[];
  chainOk: boolean;
  proofs: ProofImage[];
  generatedAt: Date;
  /** 시연·가져온 기록 경고(모든 쪽에 표시) */
  flag?: string;
}
export interface PdfFonts { serif: Uint8Array | ArrayBuffer; sans: Uint8Array | ArrayBuffer }

const W = 595.28, H = 841.89, M = 48;
const INK = rgb(0.12, 0.11, 0.18), SUB = rgb(0.36, 0.33, 0.4), FAINT = rgb(0.55, 0.52, 0.6), SEAL = rgb(0.81, 0.24, 0.16), LINE = rgb(0.89, 0.84, 0.74);

/** HTML 조각 → 평문 */
export const plain = (html: string) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

class Writer {
  page!: PDFPage;
  y = 0;
  pageNo = 0;
  /** label: 쪽마다 오른쪽 위에 찍을 표시(예: '갑 제1호증') */
  constructor(public pdf: PDFDocument, public serif: PDFFont, public sans: PDFFont, private footer: string, private label = '') { this.newPage(); }
  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.pageNo++;
    this.y = H - M;
    if (this.label) {
      const lw = this.serif.widthOfTextAtSize(this.label, 11);
      this.page.drawRectangle({ x: W - M - lw - 12, y: H - 34, width: lw + 12, height: 20, borderColor: INK, borderWidth: 0.8 });
      this.page.drawText(this.label, { x: W - M - lw - 6, y: H - 28, size: 11, font: this.serif, color: INK });
      this.y = H - M - 10;
    }
    // 고지문은 아래 여백 안에서 최대 두 줄
    this.wrap(this.footer, this.sans, 7.5, W - 2 * M - 30).slice(0, 2).forEach((ln, i, all) =>
      this.page.drawText(ln, { x: M, y: 24 + (all.length - 1 - i) * 10, size: 7.5, font: this.sans, color: FAINT }));
    this.page.drawText(String(this.pageNo), { x: W - M - 10, y: 24, size: 8, font: this.sans, color: FAINT });
  }
  ensure(h: number) { if (this.y - h < M + 10) this.newPage(); }
  /** 글자 단위로 재서 줄 바꿈(한글은 띄어쓰기가 없어도 자연스럽게 끊는다) */
  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let cur = '';
      for (const ch of para) {
        if (font.widthOfTextAtSize(cur + ch, size) > width && cur) {
          // 가능하면 띄어쓰기에서 끊는다(줄 뒤쪽 40% 안에 공백이 있을 때만, 아니면 글자 단위)
          const sp = cur.lastIndexOf(' ');
          if (ch !== ' ' && sp > cur.length * 0.6) { out.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch; }
          else { out.push(cur); cur = ch === ' ' ? '' : ch; }
        } else cur += ch;
      }
      out.push(cur);
    }
    return out;
  }
  text(t: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10, font = o.font ?? this.sans, x = o.x ?? M, width = o.width ?? W - M - x, lh = size * 1.55;
    for (const line of this.wrap(t, font, size, width)) {
      this.ensure(lh);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lh;
    }
    this.y -= o.gap ?? 0;
  }
  rule(gap = 8) { this.ensure(gap * 2); this.y -= gap; this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.6, color: LINE }); this.y -= gap; }
  heading(t: string) { this.ensure(40); this.y -= 6; this.text(t, { size: 13, font: this.serif, gap: 4 }); }
}

function drawSig(page: PDFPage, sv: SigShown | null, x: number, y: number, w: number, h: number, fonts: { serif: PDFFont; sans: PDFFont }) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
  if (!sv) return;
  if (!Array.isArray(sv)) {
    let size = 20;
    while (fonts.serif.widthOfTextAtSize(sv.typed, size) > w - 16 && size > 9) size -= 1;
    const tw = fonts.serif.widthOfTextAtSize(sv.typed, size);
    page.drawText(sv.typed, { x: x + (w - tw) / 2, y: y + h / 2 - size / 3 + 4, size, font: fonts.serif, color: INK });
    const cap = '이름 입력 서명', cw = fonts.sans.widthOfTextAtSize(cap, 7);
    page.drawText(cap, { x: x + (w - cw) / 2, y: y + 5, size: 7, font: fonts.sans, color: FAINT });
    return;
  }
  const k = Math.min(w / 200, h / 60);
  for (const s of sv) {
    for (let i = 2; i < s.length; i += 2) {
      page.drawLine({ start: { x: x + s[i - 2] * k, y: y + h - s[i - 1] * k }, end: { x: x + s[i] * k, y: y + h - s[i + 1] * k }, thickness: 1.1, color: INK });
    }
  }
}

/** 새 PDF 문서와 한글 폰트 */
async function newDoc(fonts: PdfFonts) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const serif = await pdf.embedFont(fonts.serif, { subset: false });
  const sans = await pdf.embedFont(fonts.sans, { subset: false });
  pdf.setCreator('키프 Keep'); pdf.setProducer('키프 Keep'); pdf.setLanguage('ko-KR');
  return { pdf, serif, sans };
}

/** 표지 머리: 작은 제목 + 큰 제목 + 경고 + 번호·시각 */
function header(w: Writer, inp: Pick<EvidenceInput, 'doc' | 'flag' | 'generatedAt'>, kicker: string, title: string) {
  const d = inp.doc;
  w.text(kicker, { size: 10, color: SEAL });
  w.text(title, { size: 22, font: w.serif, gap: 2 });
  if (inp.flag) w.text(`※ ${inp.flag}`, { size: 11, color: SEAL, gap: 2 });
  w.text(`증서번호 ${d.code} · 작성 ${d.createdAt ? stamp(d.createdAt) : ''} · 만든 시각 ${stamp(inp.generatedAt)} (KST)`, { size: 8.5, color: SUB, gap: 4 });
  w.rule();
}

/** 약속증서 본문·서명 두 칸·확인코드 */
function sectionCert(w: Writer, inp: EvidenceInput, heading: string) {
  const d = inp.doc, T = TPL[d.tpl], { serif, sans } = w;
  w.heading(heading);
  const { lead, rows } = certBody(d);
  w.text(plain(lead), { size: 11, font: serif, gap: 6 });
  const cells = [...rows.matchAll(/<tr><th>(.*?)<\/th><td[^>]*>(.*?)<\/td><\/tr>/g)].map((m) => [plain(m[1]), plain(m[2])]);
  for (const [k, v] of cells) {
    const lines = w.wrap(v, serif, 10.5, W - 2 * M - 110);
    w.ensure(lines.length * 16 + 6);
    w.page.drawText(k, { x: M, y: w.y - 10.5, size: 9.5, font: sans, color: SUB });
    lines.forEach((ln, i) => w.page.drawText(ln, { x: M + 110, y: w.y - 10.5 - i * 16, size: 10.5, font: serif, color: INK }));
    w.y -= lines.length * 16 + 4;
    w.page.drawLine({ start: { x: M, y: w.y }, end: { x: W - M, y: w.y }, thickness: 0.4, color: LINE });
    w.y -= 4;
  }
  if (d.amendments.length) { w.y -= 4; w.text('변경 이력', { size: 9.5, color: SUB }); for (const a of d.amendments) w.text(`${stamp(a.at)} · ${a.text}`, { size: 9.5 }); }

  // 서명 두 칸
  w.ensure(130);
  w.y -= 8;
  const boxW = (W - 2 * M - 16) / 2;
  for (const [i, role] of (['A', 'B'] as const).entries()) {
    const p = inp.parties.find((x) => x.role === role);
    const x = M + i * (boxW + 16);
    w.page.drawText(`${role === 'A' ? '작성자 · ' + T.a : '상대방 · ' + T.b}`, { x, y: w.y - 9, size: 8.5, font: sans, color: SUB });
    w.page.drawText(p?.name || '', { x, y: w.y - 25, size: 13, font: serif, color: INK });
    drawSig(w.page, role === 'A' ? inp.sigs.A : inp.sigs.B, x, w.y - 92, boxW, 60, { serif, sans });
    w.page.drawText(p?.signedAt ? `${stamp(p.signedAt)} 서명 · 지문 ${String(p.sha || '').slice(0, 12).toUpperCase()}` : '서명 없음', { x, y: w.y - 104, size: 8, font: sans, color: SUB });
  }
  w.y -= 116;
  w.text(`확인코드 ${shortCode(d.currentHash)}`, { size: 11, font: serif, color: SEAL });
  w.text(`SHA-256 ${d.currentHash}`, { size: 7.5, color: SUB, gap: 4 });
}

/** 서명 메타데이터(시각·IP·기기·서명 파일 지문) */
function sectionMeta(w: Writer, inp: EvidenceInput, heading: string) {
  w.heading(heading);
  for (const p of inp.parties) {
    w.text(`${p.role === 'A' ? '작성자' : '상대방'} ${p.name}`, { size: 10.5, font: w.serif });
    w.text(`서명 시각 ${p.signedAt ? stamp(p.signedAt) : '-'} · 동의 시각 ${p.consentAt ? stamp(p.consentAt) : '-'}`, { size: 9 });
    w.text(`접속 IP(참고용) ${p.ip || '-'} · 기기 ${p.ua || '-'}`, { size: 8.5, color: SUB });
    w.text(`서명 파일 지문 ${p.sha || '-'}`, { size: 7.5, color: SUB, gap: 4 });
  }
}

/** 이벤트 해시 체인(전부 또는 고른 기록만) */
function sectionChain(w: Writer, inp: EvidenceInput, heading: string, only?: (e: EventRow) => boolean) {
  const d = inp.doc;
  w.heading(heading);
  const list = only ? inp.events.filter(only) : inp.events;
  w.text(inp.chainOk ? `기록 ${inp.events.length}건의 해시 사슬이 처음부터 끝까지 이어져 있어요. 각 기록의 해시 = SHA-256(앞 기록 해시 + 기록 내용 + 기록 시각).${only ? ` 이 중 ${list.length}건을 실었어요.` : ''}` : '주의: 해시 사슬이 중간에 끊겨 있어요. 기록이 바뀌었을 수 있어요.', { size: 9, color: inp.chainOk ? SUB : SEAL, gap: 4 });
  const names = { a: d.aName, b: d.bName };
  list.forEach((e, i) => {
    const t = eventText(e, names);
    w.ensure(60);
    w.text(`${i + 1}. ${t.title}`, { size: 10, font: w.serif });
    w.text(`${stamp(e.created_at)} (서버 시각)${e.sim_at ? ` · 시연 날짜 ${e.sim_at}` : ''} · ${e.actor_role === 'A' ? d.aName : e.actor_role === 'B' ? d.bName : '키프'}`, { size: 8.5, color: SUB });
    if (t.detail) w.text(t.detail, { size: 8.5 });
    const full = (e.payload as { text?: unknown } | null)?.text;
    if (only && typeof full === 'string' && full !== t.detail) w.text(full, { size: 9, gap: 2 });
    w.text(`hash ${e.hash}`, { size: 7, color: FAINT });
    w.text(`prev ${e.prev_hash || '(처음)'}`, { size: 7, color: FAINT, gap: 4 });
  });
}

/** 첨부 캡처 한 장(새 쪽). 넣지 못하면 false */
async function sectionProof(w: Writer, img: ProofImage, heading: string, first = false): Promise<boolean> {
  let emb;
  try { emb = img.mime.includes('png') ? await w.pdf.embedPng(img.bytes) : await w.pdf.embedJpg(img.bytes); } catch { return false; }
  if (!first) w.newPage();
  w.heading(heading);
  w.text(img.caption, { size: 9, color: SUB, gap: 6 });
  const maxW = W - 2 * M, maxH = w.y - M - 30;
  const k = Math.min(maxW / emb.width, maxH / emb.height, 1);
  w.page.drawImage(emb, { x: M, y: w.y - emb.height * k, width: emb.width * k, height: emb.height * k });
  return true;
}

export async function buildEvidencePdf(inp: EvidenceInput, fonts: PdfFonts): Promise<Uint8Array> {
  const { pdf, serif, sans } = await newDoc(fonts);
  const d = inp.doc, T = TPL[d.tpl];
  pdf.setTitle(`키프 증거 묶음 · ${d.title}`);
  pdf.setSubject(`${T.name} · 확인코드 ${shortCode(d.currentHash)}`);
  const w = new Writer(pdf, serif, sans, inp.flag ? `[${inp.flag}] ${DISCLAIMER}` : DISCLAIMER);
  header(w, inp, '키프 증거 묶음', T.name);
  sectionCert(w, inp, '1. 약속증서');
  sectionMeta(w, inp, '2. 서명 메타데이터');
  sectionChain(w, inp, '3. 증거 기록 (해시 체인)');
  for (const img of inp.proofs) await sectionProof(w, img, '4. 첨부 캡처');
  return pdf.save();
}

// ------------------------------------------------------------------ 변제(이행) 완료 확인서
export interface ReceiptInput {
  doc: CertDoc & { currentHash: string };
  payments: ReceiptPayment[];
  done: { at: string; hash: string };
  chainOk: boolean;
  generatedAt: Date;
  flag?: string;
}

export async function buildReceiptPdf(inp: ReceiptInput, fonts: PdfFonts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const serif = await pdf.embedFont(fonts.serif, { subset: false });
  const sans = await pdf.embedFont(fonts.sans, { subset: false });
  const d = inp.doc;
  const r = receiptText(d, inp.payments, inp.done.at);
  pdf.setTitle(`키프 ${r.title} · ${d.title}`);
  pdf.setSubject(`${TPL[d.tpl].name} 증서번호 ${d.code}`);
  pdf.setCreator('키프 Keep'); pdf.setProducer('키프 Keep'); pdf.setLanguage('ko-KR');
  const w = new Writer(pdf, serif, sans, inp.flag ? `[${inp.flag}] ${DISCLAIMER}` : DISCLAIMER);

  w.text('키프 Keep', { size: 10, color: SEAL });
  w.y -= 10;
  const tw = serif.widthOfTextAtSize(r.title, 26);
  w.page.drawText(r.title, { x: (W - tw) / 2, y: w.y - 26, size: 26, font: serif, color: INK });
  w.y -= 44;
  if (inp.flag) w.text(`※ ${inp.flag}`, { size: 11, color: SEAL, gap: 4 });
  w.rule(10);
  w.text(r.lead, { size: 12.5, font: serif, gap: 10 });

  for (const [k, v] of r.rows) {
    const lines = w.wrap(v, serif, 10.5, W - 2 * M - 110);
    w.ensure(lines.length * 16 + 6);
    w.page.drawText(k, { x: M, y: w.y - 10.5, size: 9.5, font: sans, color: SUB });
    lines.forEach((ln, i) => w.page.drawText(ln, { x: M + 110, y: w.y - 10.5 - i * 16, size: 10.5, font: serif, color: INK }));
    w.y -= lines.length * 16 + 4;
    w.page.drawLine({ start: { x: M, y: w.y }, end: { x: W - M, y: w.y }, thickness: 0.4, color: LINE });
    w.y -= 4;
  }

  if (r.payments.length) {
    w.heading('상환 내역');
    for (const [date, amt, no] of r.payments) {
      w.ensure(18);
      w.page.drawText(date, { x: M, y: w.y - 10, size: 10, font: sans, color: INK });
      w.page.drawText(no, { x: M + 170, y: w.y - 10, size: 9.5, font: sans, color: SUB });
      const aw = sans.widthOfTextAtSize(amt, 10);
      w.page.drawText(amt, { x: W - M - aw, y: w.y - 10, size: 10, font: sans, color: INK });
      w.y -= 17;
    }
    if (r.paidTotal) {
      w.rule(4);
      const t = `합계 ${won(r.paidTotal)}`, tw2 = sans.widthOfTextAtSize(t, 10.5);
      w.page.drawText(t, { x: W - M - tw2, y: w.y - 11, size: 10.5, font: sans, color: INK });
      w.y -= 20;
    }
  }

  w.heading('확인 기록');
  w.text(`이 확인서는 ${d.aName}님 계정이 키프에서 '완료'를 확인한 전자 기록으로 만들었어요. 별도의 손글씨 서명은 없고, 아래 해시로 키프의 증거 기록과 대조할 수 있어요.`, { size: 9.5, color: SUB, gap: 4 });
  w.text(`완료 기록 해시 ${inp.done.hash}`, { size: 7.5, color: SUB });
  w.text(`원 증서 확인코드 ${shortCode(d.currentHash)} · SHA-256 ${d.currentHash}`, { size: 7.5, color: SUB });
  w.text(inp.chainOk ? '증거 기록의 해시 사슬이 처음부터 완료 기록까지 이어져 있어요.' : '주의: 증거 기록의 해시 사슬이 중간에 끊겨 있어요.', { size: 9, color: inp.chainOk ? SUB : SEAL, gap: 8 });
  w.text(`발급 ${stamp(inp.generatedAt)} (KST)`, { size: 9, color: SUB });
  return pdf.save();
}

// ------------------------------------------------------------------ 전자소송 제출용 묶음
export interface EcourtFile { name: string; bytes: Uint8Array }

/** 증거목록 · 호증별 PDF · 청구 내용 정리(참고용)를 파일로 나눠 만든다(묶기는 호출하는 쪽에서 ZIP으로) */
export async function buildEcourtFiles(inp: EvidenceInput, plan: EcourtPlan, fonts: PdfFonts): Promise<EcourtFile[]> {
  const d = inp.doc;
  const foot = inp.flag ? `[${inp.flag}] ${DISCLAIMER}` : DISCLAIMER;
  const out: EcourtFile[] = [];

  // 00 증거목록
  {
    const { pdf, serif, sans } = await newDoc(fonts);
    pdf.setTitle(`증거목록 · ${d.title}`);
    const w = new Writer(pdf, serif, sans, foot);
    const tw = serif.widthOfTextAtSize('증 거 목 록', 22);
    w.page.drawText('증 거 목 록', { x: (W - tw) / 2, y: w.y - 22, size: 22, font: serif, color: INK });
    w.y -= 40;
    if (inp.flag) w.text(`※ ${inp.flag}`, { size: 11, color: SEAL, gap: 4 });
    w.text(`사건: (사건번호 기재)   원고: ${d.aName}   피고: ${d.bName}`, { size: 10, gap: 6 });
    w.rule(6);
    const cols = [M, M + 92, M + 230, M + 300];
    const head = ['호증', '증거명', '작성일', '입증취지'];
    head.forEach((h, i) => w.page.drawText(h, { x: cols[i], y: w.y - 10, size: 9.5, font: sans, color: SUB }));
    w.y -= 16;
    w.rule(3);
    for (const it of plan.items) {
      const nameL = w.wrap(it.name, sans, 9.5, 130), purL = w.wrap(it.purpose, serif, 9.5, W - M - cols[3]);
      const h = Math.max(nameL.length, purL.length, 1) * 14 + 8;
      w.ensure(h);
      w.page.drawText(it.no, { x: cols[0], y: w.y - 10, size: 10, font: serif, color: INK });
      nameL.forEach((ln, i) => w.page.drawText(ln, { x: cols[1], y: w.y - 10 - i * 14, size: 9.5, font: sans, color: INK }));
      w.page.drawText(it.date ? it.date.replace(/-/g, '.') : '', { x: cols[2], y: w.y - 10, size: 9, font: sans, color: INK });
      purL.forEach((ln, i) => w.page.drawText(ln, { x: cols[3], y: w.y - 10 - i * 14, size: 9.5, font: serif, color: INK }));
      w.y -= h;
      w.page.drawLine({ start: { x: M, y: w.y + 3 }, end: { x: W - M, y: w.y + 3 }, thickness: 0.4, color: LINE });
    }
    w.y -= 8;
    w.text('입증취지는 키프 기록으로 만든 예시 문구예요. 실제 제출 전에 상황에 맞게 고쳐 주세요.', { size: 8.5, color: SUB });
    out.push({ name: '00_증거목록.pdf', bytes: await pdf.save() });
  }

  // 호증별
  for (const it of plan.items) {
    const { pdf, serif, sans } = await newDoc(fonts);
    pdf.setTitle(`${it.no} ${it.name}`);
    const w = new Writer(pdf, serif, sans, foot, it.no);
    if (it.kind === 'cert') { header(w, inp, '키프 전자 약속증서', TPL[d.tpl].name); sectionCert(w, inp, '약속증서'); }
    else if (it.kind === 'records') { header(w, inp, '키프 증거 기록', '전자서명 및 기록 내역'); sectionMeta(w, inp, '1. 서명 메타데이터'); sectionChain(w, inp, '2. 증거 기록 (해시 체인)'); }
    else if (it.kind === 'nudges') { header(w, inp, '키프 증거 기록', '이행 촉구 기록'); sectionChain(w, inp, '보낸 재촉·촉구서', (e) => e.type === 'nudge_sent' || e.type === 'notice_sent'); }
    else {
      const img = inp.proofs[it.proofIndex ?? 0];
      if (!img || !(await sectionProof(w, img, '송금 내역 캡처', true))) continue;
    }
    out.push({ name: it.file, bytes: await pdf.save() });
  }

  // 참고: 청구 내용 정리
  {
    const { pdf, serif, sans } = await newDoc(fonts);
    pdf.setTitle(`청구 내용 정리(참고) · ${d.title}`);
    const w = new Writer(pdf, serif, sans, foot);
    w.text('키프 · 참고 자료', { size: 10, color: SEAL });
    w.text('청구 내용 정리', { size: 22, font: serif, gap: 2 });
    w.text(`만든 시각 ${stamp(inp.generatedAt)} (KST) · 법원에 내는 서식이 아니에요`, { size: 8.5, color: SUB, gap: 4 });
    w.rule();
    for (const [k, v] of plan.summary) {
      const lines = w.wrap(v, serif, 10.5, W - 2 * M - 150);
      w.ensure(lines.length * 16 + 6);
      w.page.drawText(k, { x: M, y: w.y - 10.5, size: 9.5, font: sans, color: SUB });
      lines.forEach((ln, i) => w.page.drawText(ln, { x: M + 150, y: w.y - 10.5 - i * 16, size: 10.5, font: serif, color: INK }));
      w.y -= lines.length * 16 + 4;
      w.page.drawLine({ start: { x: M, y: w.y }, end: { x: W - M, y: w.y }, thickness: 0.4, color: LINE });
      w.y -= 4;
    }
    w.heading('묶음에 든 파일');
    for (const it of plan.items) w.text(`${it.file} — ${it.name}`, { size: 9.5 });
    w.heading('알아 두세요');
    for (const t of plan.notes) w.text('· ' + t, { size: 9.5, gap: 3 });
    out.push({ name: '참고_청구내용정리.pdf', bytes: await pdf.save() });
  }
  return out;
}
