// 여러 명 정산 현황: 같은 묶음의 확인서를 멤버별로 보고 링크를 보낸다
import { useEffect, useState } from 'react';
import { STATUS } from '@domain/templates.ts';
import { korDate } from '@domain/dates.ts';
import { won } from '@domain/korean.ts';
import { rowToDoc, type PartyRow, type PromiseRow } from '@domain/mapping.ts';
import { ledgerOf } from '@domain/ledger.ts';
import type { PromiseDoc } from '@domain/types.ts';
import { supabase, shareUrl } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';
import { copyText, shareText } from '../lib/share';
import { qrSVG } from '../lib/qr';

interface Row { doc: PromiseDoc; paid: number }

export function Group({ id }: { id: string }) {
  const auth = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!auth.userId) return;
    (async () => {
      const { data } = await supabase.from('promises').select('*, parties(promise_id, role, user_id, display_name, signature_sha256, signed_at, consent_at), payments(amount, confirmed_by_a)').eq('group_id', id).order('created_at');
      const list = (data || []) as (PromiseRow & { parties: PartyRow[]; payments: { amount: number | null; confirmed_by_a: boolean | null }[] })[];
      setRows(list.map((r) => { const doc = rowToDoc(r, r.parties); return { doc, paid: ledgerOf(doc, r.payments)?.paid ?? 0 }; }));
    })();
  }, [id, auth.userId]);
  if (!auth.ready) return null;
  if (!rows) return <div className="empty"><span className="spin" /> 불러오는 중…</div>;
  if (!rows.length) return <div className="empty">볼 수 있는 정산이 없어요.<br /><br /><button className="btn" onClick={() => go('/')}>홈으로</button></div>;
  const total = rows.reduce((n, r) => n + (r.doc.amount || 0), 0);
  const paid = rows.reduce((n, r) => n + r.paid, 0);
  const signed = rows.filter((r) => r.doc.sigB).length;
  const title = rows[0].doc.title.replace(/ · [^·]+$/, '');
  return (
    <>
      <div className="row between" style={{ marginTop: 8 }}><button className="btn small ghost" onClick={() => go('/')}>← 내 약속</button></div>
      <h1>{title}</h1>
      <p className="muted">경비 정산 {rows.length}명 · 기한 {korDate(rows[0].doc.deadline)}</p>
      <div className="stats">
        <div className="stat"><b>{signed}/{rows.length}</b><span>서명</span></div>
        <div className="stat"><b>{won(paid)}</b><span>받은 금액</span></div>
        <div className="stat"><b>{won(total - paid)}</b><span>남은 금액</span></div>
      </div>
      {rows.map(({ doc, paid: p }) => {
        const st = STATUS[doc.status];
        const url = shareUrl(doc.code);
        const msg = `[키프] ${doc.aName}님이 '${doc.title}' 경비 정산 확인을 요청했어요(${won(doc.amount)}). 확인 후 서명해 주세요 👉 ${url}`;
        return (
          <div className="card" key={doc.id}>
            <div className="row between"><b>{doc.bName}</b><span className={'pill ' + st.c}>{st.t}</span></div>
            <div className="faint" style={{ marginTop: 4 }}>{won(doc.amount)} · 받은 {won(p) || '0원'}</div>
            <div className="row" style={{ marginTop: 8 }}>
              {(doc.status === 'pending_b' || doc.status === 'revise') && (<>
                <button className="btn small kakao" onClick={async () => { const r = await shareText(msg); if (r === 'copied') toast('복사했어요. 카톡에 붙여넣어 보내세요.'); }}>카톡 등으로 보내기</button>
                <button className="btn small" onClick={async () => toast((await copyText(msg)) ? '복사했어요.' : '복사가 막혀 있어요.')}>링크 복사</button>
                <button className="btn small ghost" onClick={() => setQr(qr === doc.code ? '' : doc.code)}>QR</button>
              </>)}
              <button className="btn small ghost" onClick={() => go('/p/' + doc.code)}>열기</button>
            </div>
            {qr === doc.code && <div className="qrbig" dangerouslySetInnerHTML={{ __html: qrSVG(url, 'M') }} />}
          </div>
        );
      })}
    </>
  );
}
