import { certHTML, esc, type CertDoc } from '@domain/certificate.ts';
import { canonicalV3 } from '@domain/canonical.ts';
import { stamp } from '@domain/dates.ts';
import { TPL } from '@domain/templates.ts';
import { eventText, type EventRow } from '@domain/events.ts';

function pageCss(): string {
  return [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
}

/** 증서 파일(HTML). 화면 글자(data-f)와 내장 데이터(JSON)를 함께 담아 '위변조 확인'에서 둘 다 검사한다. */
export function exportCertFile(doc: CertDoc & { currentHash: string }, opts: { sigImgA?: string; sigImgB?: string; events?: EventRow[]; meta?: Record<string, unknown>[]; flag?: string } = {}) {
  const evs = opts.events || [];
  const names = { a: doc.aName, b: doc.bName };
  const tl = evs.length ? `<h2 style="font-family:sans-serif;margin:28px 0 10px">증거 타임라인 (해시 체인)</h2><div class="tl">${evs.map((e) => {
    const t = eventText(e, names);
    return `<div class="ev"><b>${esc(t.title)}</b><time>${stamp(e.created_at)}${e.sim_at ? ' · 시연 날짜 ' + esc(e.sim_at) : ''}</time>${t.detail ? `<div>${esc(t.detail)}</div>` : ''}<div style="font-size:10.5px;color:#8c8170;word-break:break-all">hash ${esc(e.hash)}<br>prev ${esc(e.prev_hash || '-')}</div></div>`;
  }).join('')}</div>` : '';
  const meta = opts.meta?.length ? `<h2 style="font-family:sans-serif;margin:28px 0 10px">서명 메타데이터</h2><table style="font-size:12px;border-collapse:collapse;width:100%">${opts.meta.map((m) => `<tr>${Object.entries(m).map(([k, v]) => `<td style="border:1px solid #e3d6bd;padding:4px"><b>${esc(k)}</b><br>${esc(v)}</td>`).join('')}</tr>`).join('')}</table>` : '';
  const payload = JSON.stringify({
    app: 'keep', v: 3, hash: doc.currentHash, exportedAt: new Date().toISOString(),
    doc: { ...JSON.parse(canonicalV3(doc)), createdAt: doc.createdAt },
    events: evs.map((e) => ({ id: e.id, type: e.type, canon: e.canon, created_at: e.created_at, prev_hash: e.prev_hash, hash: e.hash })),
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;600;700&family=Nanum+Myeongjo:wght@400;700;800&display=swap" rel="stylesheet"><title>${esc(TPL[doc.tpl].name)} · ${esc(doc.title)}</title><style>${pageCss()}\nbody{padding:24px}.wrap{max-width:640px;margin:0 auto}</style></head><body><div class="wrap">${certHTML(doc, { sigImgA: opts.sigImgA, sigImgB: opts.sigImgB, flag: opts.flag })}${meta}${tl}<p class="disc">키프는 약속의 증거를 남기고 이행을 돕는 도구입니다. 법률 자문이 아니며, 증서는 공증·강제집행력이 있는 문서가 아닙니다.</p></div><script type="application/json" id="keep-data">${payload}</` + `script></body></html>`;
}
