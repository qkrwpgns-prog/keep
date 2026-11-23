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
import type { SigVector } from '@domain/types.ts';

export interface PartyMeta { role: 'A' | 'B'; name: string; signedAt: string | null; ip: string | null; ua: string | null; consentAt: string | null; sha: string | null }
export interface ProofImage { bytes: Uint8Array; mime: string; caption: string }
export interface EvidenceInput {
  doc: CertDoc & { currentHash: string; id: string };
  parties: PartyMeta[];
  sigs: { A: SigVector | null; B: SigVector | null };
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
  constructor(private pdf: PDFDocument, public serif: PDFFont, public sans: PDFFont, private footer: string) { this.newPage(); }
  newPage() {
    this.page = this.pdf.addPage([W, H]);
    this.pageNo++;
    this.y = H - M;
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
        if (font.widthOfTextAtSize(cur + ch, size) > width && cur) { out.push(cur); cur = ch === ' ' ? '' : ch; } else cur += ch;
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

function drawSig(page: PDFPage, sv: SigVector | null, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.6 });
  if (!sv) return;
  const k = Math.min(w / 200, h / 60);
  for (const s of sv) {
    for (let i = 2; i < s.length; i += 2) {
      page.drawLine({ start: { x: x + s[i - 2] * k, y: y + h - s[i - 1] * k }, end: { x: x + s[i] * k, y: y + h - s[i + 1] * k }, thickness: 1.1, color: INK });
    }
  }
}

export async function buildEvidencePdf(inp: EvidenceInput, fonts: PdfFonts): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const serif = await pdf.embedFont(fonts.serif, { subset: false });
  const sans = await pdf.embedFont(fonts.sans, { subset: false });
  const d = inp.doc, T = TPL[d.tpl];
  pdf.setTitle(`키프 증거 묶음 · ${d.title}`);
  pdf.setSubject(`${T.name} · 확인코드 ${shortCode(d.currentHash)}`);
  pdf.setCreator('키프 Keep');
  pdf.setProducer('키프 Keep');
  pdf.setLanguage('ko-KR');
  const w = new Writer(pdf, serif, sans, inp.flag ? `[${inp.flag}] ${DISCLAIMER}` : DISCLAIMER);

  // 표지 머리
  w.text('키프 증거 묶음', { size: 10, color: SEAL });
  w.text(T.name, { size: 22, font: serif, gap: 2 });
  if (inp.flag) w.text(`※ ${inp.flag}`, { size: 11, color: SEAL, gap: 2 });
  w.text(`증서번호 ${d.code} · 작성 ${d.createdAt ? stamp(d.createdAt) : ''} · 만든 시각 ${stamp(inp.generatedAt)} (KST)`, { size: 8.5, color: SUB, gap: 4 });
  w.rule();

  // 1. 약속증서
  w.heading('1. 약속증서');
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
    drawSig(w.page, role === 'A' ? inp.sigs.A : inp.sigs.B, x, w.y - 92, boxW, 60);
    w.page.drawText(p?.signedAt ? `${stamp(p.signedAt)} 서명 · 지문 ${String(p.sha || '').slice(0, 12).toUpperCase()}` : '서명 없음', { x, y: w.y - 104, size: 8, font: sans, color: SUB });
  }
  w.y -= 116;
  w.text(`확인코드 ${shortCode(d.currentHash)}`, { size: 11, font: serif, color: SEAL });
  w.text(`SHA-256 ${d.currentHash}`, { size: 7.5, color: SUB, gap: 4 });

  // 2. 서명 메타데이터
  w.heading('2. 서명 메타데이터');
  for (const p of inp.parties) {
    w.text(`${p.role === 'A' ? '작성자' : '상대방'} ${p.name}`, { size: 10.5, font: serif });
    w.text(`서명 시각 ${p.signedAt ? stamp(p.signedAt) : '-'} · 동의 시각 ${p.consentAt ? stamp(p.consentAt) : '-'}`, { size: 9 });
    w.text(`접속 IP(참고용) ${p.ip || '-'} · 기기 ${p.ua || '-'}`, { size: 8.5, color: SUB });
    w.text(`서명 파일 지문 ${p.sha || '-'}`, { size: 7.5, color: SUB, gap: 4 });
  }

  // 3. 이벤트 해시 체인
  w.heading('3. 증거 기록 (해시 체인)');
  w.text(inp.chainOk ? `기록 ${inp.events.length}건의 해시 사슬이 처음부터 끝까지 이어져 있어요. 각 기록의 해시 = SHA-256(앞 기록 해시 + 기록 내용 + 기록 시각).` : '주의: 해시 사슬이 중간에 끊겨 있어요. 기록이 바뀌었을 수 있어요.', { size: 9, color: inp.chainOk ? SUB : SEAL, gap: 4 });
  const names = { a: d.aName, b: d.bName };
  inp.events.forEach((e, i) => {
    const t = eventText(e, names);
    w.ensure(60);
    w.text(`${i + 1}. ${t.title}`, { size: 10, font: serif });
    w.text(`${stamp(e.created_at)} (서버 시각)${e.sim_at ? ` · 시연 날짜 ${e.sim_at}` : ''} · ${e.actor_role === 'A' ? d.aName : e.actor_role === 'B' ? d.bName : '키프'}`, { size: 8.5, color: SUB });
    if (t.detail) w.text(t.detail, { size: 8.5 });
    w.text(`hash ${e.hash}`, { size: 7, color: FAINT });
    w.text(`prev ${e.prev_hash || '(처음)'}`, { size: 7, color: FAINT, gap: 4 });
  });

  // 4. 첨부 캡처
  for (const img of inp.proofs) {
    let emb;
    try { emb = img.mime.includes('png') ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes); } catch { continue; }
    w.newPage();
    w.heading('4. 첨부 캡처');
    w.text(img.caption, { size: 9, color: SUB, gap: 6 });
    const maxW = W - 2 * M, maxH = w.y - M - 30;
    const k = Math.min(maxW / emb.width, maxH / emb.height, 1);
    w.page.drawImage(emb, { x: M, y: w.y - emb.height * k, width: emb.width * k, height: emb.height * k });
  }

  return pdf.save();
}
