import { useEffect, useMemo, useState } from 'react';
import { kstToday, shortDate } from '@domain/dates.ts';
import { won } from '@domain/korean.ts';
import { moneySummary, type MoneyRow, type MoneySummary } from '@domain/money.ts';
import { listMine, loadPaymentsFor, type ListItem } from '../lib/api';
import { useAuth } from '../lib/auth';
import { go } from '../lib/router';

/** 내 약속 목록 + 상환 기록 → 현황(홈 카드와 상세 화면이 같이 씀) */
export function useMoney(items: ListItem[] | null): MoneySummary | null {
  const [pays, setPays] = useState<Record<string, { amount: number | null; confirmed_by_a: boolean | null }[]> | null>(null);
  const ids = useMemo(() => (items || []).filter((x) => !x.doc.isDemo && x.doc.amount && (x.doc.status === 'active' || x.doc.status === 'reported')).map((x) => x.doc.id), [items]);
  const key = ids.join(',');
  useEffect(() => {
    if (!items) return;
    loadPaymentsFor(key ? key.split(',') : []).then(setPays).catch(() => setPays({}));
  }, [items, key]);
  return useMemo(() => (items && pays ? moneySummary(items, pays, kstToday()) : null), [items, pays]);
}

const dueText = (r: MoneyRow) => (r.daysLeft < 0 ? `${-r.daysLeft}일 지남` : r.daysLeft === 0 ? '오늘까지' : r.daysLeft > 999 ? '기한 없음' : `${r.daysLeft}일 남음`);

/** 홈 위쪽 요약 카드 */
export function MoneyCard({ s }: { s: MoneySummary }) {
  if (!s.rows.length && !s.waitingSign.in && !s.waitingSign.out) return null;
  return (
    <button className="card money-card" onClick={() => go('/money')} aria-label="받을 돈·갚을 돈 자세히 보기">
      <div className="money-two">
        <div><span className="faint">받을 돈</span><b className="m-in">{won(s.incoming.remaining) || '0원'}</b>{s.incoming.overdue > 0 && <small className="m-late">기한 지남 {won(s.incoming.overdue)}</small>}</div>
        <div><span className="faint">갚을 돈</span><b className="m-out">{won(s.outgoing.remaining) || '0원'}</b>{s.outgoing.overdue > 0 && <small className="m-late">기한 지남 {won(s.outgoing.overdue)}</small>}</div>
      </div>
      <div className="row between" style={{ marginTop: 8, fontSize: 12.5, gap: 8 }}>
        <span className="faint" style={{ textAlign: 'left' }}>{s.rows[0] ? `가장 가까운 기한 · ${s.rows[0].other}님 ${won(s.rows[0].dueAmount)} ${s.rows[0].dir === 'in' ? '받기' : '갚기'} · ${dueText(s.rows[0])}` : '서명 대기 중인 돈 약속만 있어요.'}</span>
        <span style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>자세히 ›</span>
      </div>
    </button>
  );
}

/** #/money: 받을 돈·갚을 돈 자세히 */
export function Money() {
  const auth = useAuth();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (auth.userId) listMine(auth.userId).then(setItems).catch((e) => setErr(e.message)); }, [auth.userId]);
  const s = useMoney(items);
  const [tab, setTab] = useState<'all' | 'in' | 'out'>('all');

  if (!auth.userId) return <div className="card"><p className="muted">로그인하면 받을 돈·갚을 돈을 한눈에 볼 수 있어요.</p><button className="btn block" onClick={() => go('/settings')}>로그인하러 가기</button></div>;
  if (err) return <div className="card warn flat">{err}</div>;
  if (!s) return <div className="empty"><span className="spin" /></div>;
  const rows = s.rows.filter((r) => tab === 'all' || r.dir === tab);

  return (
    <>
      <h1>받을 돈 · 갚을 돈</h1>
      <p className="muted">서명이 끝난 돈 약속 중 아직 다 갚지 않은 것만 모았어요. 상대가 '보냈어요'라고 신고했지만 아직 확인하지 않은 돈은 남은 금액에 포함돼 있어요.</p>
      <div className="card money-card" style={{ cursor: 'default' }}>
        <div className="money-two">
          <div><span className="faint">받을 돈 · {s.incoming.count}건</span><b className="m-in">{won(s.incoming.remaining) || '0원'}</b><small className="faint">지금까지 받음 {won(s.incoming.paid) || '0원'}</small></div>
          <div><span className="faint">갚을 돈 · {s.outgoing.count}건</span><b className="m-out">{won(s.outgoing.remaining) || '0원'}</b><small className="faint">지금까지 갚음 {won(s.outgoing.paid) || '0원'}</small></div>
        </div>
        {(s.incoming.overdue > 0 || s.outgoing.overdue > 0) && <p className="m-late" style={{ margin: '8px 0 0', fontSize: 13 }}>기한 지남 · 받을 돈 {won(s.incoming.overdue) || '0원'} · 갚을 돈 {won(s.outgoing.overdue) || '0원'}</p>}
        {(s.waitingSign.in > 0 || s.waitingSign.out > 0) && <p className="faint" style={{ margin: '6px 0 0', fontSize: 12.5 }}>서명 대기 중인 약속은 빠져 있어요(받을 돈 {won(s.waitingSign.in) || '0원'} · 갚을 돈 {won(s.waitingSign.out) || '0원'}).</p>}
      </div>

      {s.people.length > 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>사람별로 보면</h3>
          {s.people.map((p) => (
            <div key={p.name} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <span>{p.name}</span>
              <span style={{ textAlign: 'right' }}>
                <b className={p.net >= 0 ? 'm-in' : 'm-out'}>{p.net >= 0 ? `받을 돈 ${won(p.net)}` : `갚을 돈 ${won(-p.net)}`}</b>
                {p.incoming > 0 && p.outgoing > 0 && <small className="faint" style={{ display: 'block' }}>받을 {won(p.incoming)} − 갚을 {won(p.outgoing)}</small>}
              </span>
            </div>
          ))}
          <p className="faint" style={{ fontSize: 12, marginTop: 6 }}>증서에 적힌 이름이 같으면 같은 사람으로 묶었어요. 서로 상계(퉁치기)하려면 각 약속에서 상환을 기록해 주세요.</p>
        </div>
      )}

      <div className="seg" style={{ margin: '4px 0 10px' }}>
        {([['all', '전체'], ['in', '받을 돈'], ['out', '갚을 돈']] as const).map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}
      </div>
      {rows.length === 0 && <div className="empty">{tab === 'out' ? '갚을 돈이 없어요.' : tab === 'in' ? '받을 돈이 없어요.' : '아직 갚는 중인 돈 약속이 없어요.'}</div>}
      <div className="list">
        {rows.map((r) => (
          <button key={r.id} className="item" onClick={() => go('/p/' + r.code)}>
            <div className="row between"><span className="t">{r.title}</span><span className={'dday ' + (r.overdue ? 'late' : '')}>{dueText(r)}</span></div>
            <div className="s">{r.dir === 'in' ? `${r.other}님에게 받을 돈` : `${r.other}님에게 갚을 돈`} · 다음 {shortDate(r.due)} {won(r.dueAmount)}</div>
            <div className="bar" style={{ marginTop: 8 }} role="img" aria-label={`${won(r.total)} 중 ${won(r.paid)} ${r.dir === 'in' ? '받음' : '갚음'}`}><i style={{ width: Math.round((r.paid / r.total) * 100) + '%' }} /></div>
            <div className="row between" style={{ fontSize: 12.5, marginTop: 4 }}>
              <span className="faint">{won(r.paid) || '0원'} / {won(r.total)}{r.pending > 0 ? ` · 확인 대기 ${won(r.pending)}` : ''}</span>
              <b className={'m-' + r.dir}>남은 {won(r.remaining)}</b>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
