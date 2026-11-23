import { useCallback, useEffect, useState } from 'react';
import { TPL } from '@domain/templates.ts';
import { stamp } from '@domain/dates.ts';
import { adminCall, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';

interface Report {
  id: string; reason: string; status: 'open' | 'dismissed' | 'actioned'; admin_note: string | null; created_at: string; handled_at: string | null;
  reporter_role: 'A' | 'B' | null;
  promise: { id: string; share_code: string; template: keyof typeof TPL; title: string; status: string; deadline: string | null; amount: number | null; is_demo: boolean; nudge_blocked: boolean };
  parties: { role: 'A' | 'B'; name: string }[];
  nudges: { stage: number; status: string; message: string | null; tone: number | null; sent_at: string | null }[];
  author: { suspended_until: string | null; reports: number } | null;
}

const TABS = [['open', '대기'], ['actioned', '조치함'], ['dismissed', '기각'], ['all', '전체']] as const;
const STATUS_TEXT = { open: '대기', actioned: '조치함', dismissed: '기각' };
const STAGE_TEXT: Record<number, string> = { 1: '3일 전 알림', 2: '당일 알림', 3: '1차 재촉', 4: '2차 재촉', 5: '이행 촉구서' };

/** 운영자 화면: 신고 목록과 처리(재촉 멈춤·작성자 재촉 정지·기각). ADMIN_EMAILS에 든 계정만 */
export function Admin() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('open');
  const [list, setList] = useState<Report[] | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try { setList((await adminCall<{ reports: Report[] }>({ action: 'reports', status: tab })).reports); setDenied(false); }
    catch (e) { if (e instanceof ApiError && (e.code === 'NOT_ADMIN' || e.code === 'LOGIN')) setDenied(true); else toast(e instanceof ApiError ? e.message : '불러오지 못했어요.'); }
  }, [tab, toast]);
  useEffect(() => { if (auth.userId) void load(); }, [auth.userId, load]);

  if (!auth.userId || denied) return <div className="card"><p className="muted">운영자만 볼 수 있는 화면이에요.</p><button className="btn block" onClick={() => go('/settings')}>설정으로</button></div>;

  return (
    <>
      <h1>신고 처리</h1>
      <p className="muted">받은 쪽이 '이 재촉 신고'로 보낸 내용이에요. 재촉 문구를 보고 괴롭힘·협박·과도한 재촉인지 판단해 주세요. 처리 결과는 신고한 사람에게, 조치했다면 작성자에게도 알림이 가요.</p>
      <div className="seg" style={{ margin: '10px 0 14px' }}>
        {TABS.map(([k, t]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setList(null); }}>{t}</button>)}
      </div>
      {!list && <div className="empty"><span className="spin" /></div>}
      {list && list.length === 0 && <div className="empty">{tab === 'open' ? '처리할 신고가 없어요.' : '신고가 없어요.'}</div>}
      {list?.map((r) => <ReportCard key={r.id} r={r} onDone={load} />)}
    </>
  );
}

function ReportCard({ r, onDone }: { r: Report; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [note, setNote] = useState(r.admin_note || '');
  const [block, setBlock] = useState(r.promise.nudge_blocked || r.status === 'open');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const A = r.parties.find((p) => p.role === 'A')?.name || '-', B = r.parties.find((p) => p.role === 'B')?.name || '-';
  const sent = r.nudges.filter((n) => n.message);

  const submit = async (status: 'actioned' | 'dismissed' | 'open', extra: { block?: boolean | null; suspendDays?: number | null } = {}) => {
    setBusy(true);
    try {
      await adminCall({ action: 'handle', id: r.id, status, note, block: extra.block ?? null, suspendDays: extra.suspendDays ?? null });
      toast(status === 'actioned' ? '조치했어요. 당사자에게 알렸어요.' : status === 'dismissed' ? '기각했어요. 신고한 사람에게 알렸어요.' : '대기로 되돌렸어요.');
      await onDone();
    } catch (e) { toast(e instanceof ApiError ? e.message : '처리하지 못했어요.'); }
    setBusy(false);
  };

  return (
    <div className={'card' + (r.status === 'open' ? ' warn' : '')}>
      <div className="row between">
        <b>{r.promise.title}</b>
        <span className={'pill ' + (r.status === 'open' ? 'warn' : r.status === 'actioned' ? 'seal' : '')}>{STATUS_TEXT[r.status]}</span>
      </div>
      <p className="faint" style={{ margin: '4px 0 8px', fontSize: 12.5 }}>
        {TPL[r.promise.template]?.name} · {A} → {B} · 신고 {stamp(r.created_at)} · {r.reporter_role === 'B' ? '받은 쪽이 신고' : r.reporter_role === 'A' ? '작성자가 신고' : '신고자 탈퇴'}{r.promise.is_demo ? ' · 시연' : ''}
      </p>
      <div className="quote" style={{ marginBottom: 8 }}>{r.reason}</div>
      {sent.length > 0
        ? sent.map((n, i) => <div key={i} style={{ marginBottom: 6 }}><span className="pill">{STAGE_TEXT[n.stage] || n.stage + '단계'}{n.tone ? ` · 어조 ${n.tone}` : ''}</span><div className="faint" style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 4 }}>{n.message!.length > 600 ? n.message!.slice(0, 600) + '…' : n.message}</div></div>)
        : <p className="faint" style={{ fontSize: 13 }}>보낸 재촉 문구가 없어요(자동 알림만 있었어요).</p>}
      <p className="faint" style={{ fontSize: 12.5 }}>
        작성자 누적 신고 {r.author?.reports ?? 0}건{r.author?.suspended_until && new Date(r.author.suspended_until) > new Date() ? ` · ${r.author.suspended_until.slice(0, 10)}까지 재촉 정지 중` : ''}
        {r.promise.nudge_blocked ? ' · 이 약속 재촉 멈춤' : ''}
      </p>

      <input className="i" placeholder="처리 메모(운영 기록용, 당사자에게는 안 보여요)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 6 }} />
      <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> 이 약속의 재촉·촉구서·자동 알림 멈추기</label>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>작성자 전체 재촉 정지</span>
        <input className="i" inputMode="numeric" placeholder="일수(비우면 안 함, 0은 해제)" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} style={{ flex: 1 }} />
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        {r.status !== 'open' && <button className="btn small ghost" disabled={busy} onClick={() => submit('open')}>대기로</button>}
        <button className="btn" disabled={busy} onClick={() => submit('dismissed', { block: r.promise.nudge_blocked && !block ? false : null })}>기각</button>
        <button className="btn seal grow" disabled={busy} onClick={() => submit('actioned', { block, suspendDays: days === '' ? null : Number(days) })}>조치하고 닫기</button>
      </div>
    </div>
  );
}
