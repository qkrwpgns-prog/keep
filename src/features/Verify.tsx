import { useEffect, useState } from 'react';
import { canonicalV2, canonicalV3, eventHash, sha256Hex, shortCode, type LegacyPromise } from '@domain/canonical.ts';
import { certBody, FIELD_LABELS, type CertDoc } from '@domain/certificate.ts';
import { isTemplateKey } from '@domain/templates.ts';
import { listMine, loadDetail, type ListItem } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Result { ok: boolean; lines: string[] }

/** 파일 속 화면 글자(data-f)가 내장 데이터로 다시 만든 글자와 같은지 */
function compareFields(doc: Document, cert: CertDoc): string[] {
  const fresh = document.createElement('div');
  const cb = certBody(cert);
  fresh.innerHTML = cb.lead + '<table>' + cb.rows + '</table>';
  const want: Record<string, string> = {};
  fresh.querySelectorAll<HTMLElement>('[data-f]').forEach((el) => { want[el.dataset.f!] = el.textContent!.trim(); });
  const bad = new Set<string>();
  doc.querySelectorAll<HTMLElement>('[data-f]').forEach((el) => { const k = el.dataset.f!; if (k in want && want[k] !== el.textContent!.trim()) bad.add(k); });
  return [...bad].map((k) => FIELD_LABELS[k] || k);
}

export async function verifyCertFile(text: string): Promise<Result> {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const data = JSON.parse(doc.getElementById('keep-data')!.textContent!);
    if (data.app !== 'keep') throw new Error();
    const lines: string[] = [];
    let ok: boolean;
    let cert: CertDoc;
    if (data.v === 3) {
      const d = data.doc;
      const h = await sha256Hex(canonicalV3(d));
      ok = h === data.hash;
      lines.push(`증서번호 ${d.code} · ${d.title}`, `파일에 적힌 확인코드 ${shortCode(data.hash)}`, `내용으로 다시 계산한 코드 ${shortCode(h)}`);
      cert = { ...d, createdAt: d.createdAt };
      if (Array.isArray(data.events) && data.events.length) {
        let prev: string | null = null, chainOk = true;
        for (const e of data.events) { if (e.prev_hash !== prev || (await eventHash(prev, e.canon, e.created_at)) !== e.hash) { chainOk = false; break; } prev = e.hash; }
        lines.push(chainOk ? `증거 기록 ${data.events.length}건의 해시 사슬이 이어져 있어요.` : '증거 기록의 해시 사슬이 끊겨 있어요.');
        ok &&= chainOk;
      }
    } else {
      // 이전 버전(v2) 증서 파일
      const p = data.promise as LegacyPromise;
      const h = await sha256Hex(canonicalV2(p));
      ok = h === data.hash;
      lines.push(`이전 버전 증서 · ${p.title}`, `파일에 적힌 확인코드 ${shortCode(data.hash)}`, `내용으로 다시 계산한 코드 ${shortCode(h)}`);
      if (!isTemplateKey(p.tpl)) throw new Error();
      cert = { code: String(p.id).toUpperCase(), tpl: p.tpl, title: p.title || '', aName: p.aName || '', bName: p.bName || '', amount: p.amount ?? null, interestRate: null, lateInterestRate: null, repayAccount: '', item: p.item || '', task: p.task || '', deadline: p.deadline || '', method: p.method || '', penalty: p.penalty || '', memo: p.memo || '', installments: (p.installments || []).map((x) => ({ ...x })), amendments: [], sigA: null, sigB: null, createdAt: '' };
    }
    const bad = compareFields(doc, cert);
    if (bad.length) { ok = false; lines.push('화면 글자가 원본과 다른 항목: ' + bad.join(', ')); }
    lines.push(ok ? '이 파일은 서명된 원본 그대로예요.' : '이 파일은 서명 이후 바뀌었어요.');
    return { ok, lines };
  } catch {
    return { ok: false, lines: ['키프 증서 파일이 아니거나 증서 데이터가 손상됐어요.'] };
  }
}

const ResultView = ({ r }: { r: Result }) => (
  <div className="card flat" style={{ marginTop: 10 }}>
    {r.ok ? <div className="verify-ok">✓ 원본과 일치해요</div> : <div className="verify-bad">✕ 원본과 달라요</div>}
    <div className="faint" style={{ marginTop: 6 }}>{r.lines.map((l, i) => <div key={i}>{l}</div>)}</div>
  </div>
);

export function Verify() {
  const auth = useAuth();
  const [file, setFile] = useState<Result | null>(null);
  const [mine, setMine] = useState<ListItem[]>([]);
  const [pick, setPick] = useState('');
  const [store, setStore] = useState<Result | null>(null);
  useEffect(() => { if (auth.userId) listMine(auth.userId).then((x) => setMine(x.filter((i) => i.doc.sigA && i.doc.sigB && i.doc.currentHash))).catch(() => {}); }, [auth.userId]);

  const checkMine = async () => {
    const item = mine.find((x) => x.doc.code === pick);
    if (!item || !auth.userId) return;
    const det = await loadDetail(item.doc.code, auth.userId);
    if (!det) return;
    const lines: string[] = [];
    let ok = true;
    if (det.canonicalVersion === 2 && det.legacyDoc) {
      const h = await sha256Hex(canonicalV2(det.legacyDoc as LegacyPromise));
      ok = h === det.doc.currentHash;
      lines.push(`이전 버전 확인코드 ${shortCode(det.doc.currentHash)} · 다시 계산 ${shortCode(h)}`);
    } else {
      const h = await sha256Hex(canonicalV3(det.doc));
      ok = h === det.doc.currentHash;
      lines.push(`저장된 확인코드 ${shortCode(det.doc.currentHash)}`, `다시 계산한 코드 ${shortCode(h)}`);
    }
    let prev: string | null = null, chain = true;
    for (const e of det.events) { if (e.prev_hash !== prev || (await eventHash(prev, e.canon, e.created_at)) !== e.hash) { chain = false; break; } prev = e.hash; }
    lines.push(chain ? `증거 기록 ${det.events.length}건의 해시 사슬이 이어져 있어요.` : '증거 기록의 해시 사슬이 끊겨 있어요.');
    ok &&= chain;
    lines.push(ok ? '서명 이후 내용이 바뀌지 않았어요. 상대 화면의 확인코드와 같은지도 비교해 보세요.' : '저장된 내용이 서명 당시와 달라요.');
    setStore({ ok, lines });
  };

  return (
    <>
      <h1>위변조 확인</h1>
      <p className="muted">증서 내용이 서명한 뒤에 바뀌었는지 SHA-256 지문으로 검사해요.</p>
      <div className="card">
        <h2>저장한 증서 파일 검사</h2>
        <p className="muted">'증서 파일 저장'이나 '증거 묶음 저장'으로 받은 HTML 파일을 올려 주세요. 이전 버전 키프에서 받은 증서 파일도 검사할 수 있어요. 파일 속 금액·날짜를 한 글자라도 고치면 불일치로 나와요.</p>
        <label className="btn block">증서 파일 선택<input type="file" accept=".html,text/html" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setFile(await verifyCertFile(await f.text())); }} /></label>
        {file && <ResultView r={file} />}
      </div>
      <div className="card">
        <h2>내 계정의 증서 검사</h2>
        {!auth.userId ? <p className="faint">로그인하면 내 증서를 서버 기록과 대조해 검사할 수 있어요.</p> : mine.length ? (<>
          <select className="i" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">약속 선택</option>
            {mine.map((x) => <option key={x.doc.id} value={x.doc.code}>{x.doc.title} · {shortCode(x.doc.currentHash)}</option>)}
          </select>
          <button className="btn block" style={{ marginTop: 8 }} disabled={!pick} onClick={checkMine}>검사하기</button>
          {store && <ResultView r={store} />}
        </>) : <p className="faint">양쪽 서명이 끝난 증서가 아직 없어요.</p>}
      </div>
      <div className="card flat">
        <h3>어떻게 확인하나요?</h3>
        <p className="muted" style={{ fontSize: 13.5 }}>증서가 확정될 때 당사자·금액·기한·서명 시각·서명 파일 지문을 하나로 묶어 SHA-256 지문(확인코드)을 만들어요. 서명·요청·신고 같은 모든 기록도 앞 기록의 지문을 이어 받는 사슬로 저장돼, 중간 기록 하나만 바뀌어도 사슬이 끊겨요.</p>
      </div>
    </>
  );
}
