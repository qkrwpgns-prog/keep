import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGES, STATUS, TPL } from '@domain/templates.ts';
import { addDays, ddayLabel, diffDays, isYmd, korDate, shortDate, stamp } from '@domain/dates.ts';
import { eventHash, shortCode } from '@domain/canonical.ts';
import { strokesToVector } from '@domain/signature.ts';
import { DEMO_OFFSETS, docToday, promiseStage, splitPlan, subjectText } from '@domain/progress.ts';
import { ledgerOf } from '@domain/ledger.ts';
import { makeIcs } from '@domain/ics.ts';
import { clip, won } from '@domain/korean.ts';
import { certFlag, type CertDoc } from '@domain/certificate.ts';
import { Certificate } from '../components/Certificate';
import { SignaturePad, type Strokes } from '../components/SignaturePad';
import { LoginSheet } from '../components/LoginSheet';
import { ConsentBox } from '../components/Consent';
import { Timeline } from '../components/Timeline';
import { action, ai, aiReasonText, ApiError, loadDetail, loadSignatures, preview, type Detail as DetailT, type ProofReading, type PublicPreview } from '../lib/api';
import { AiBadge } from '../components/AiBadge';
import { shrinkImage, type ImageData64 } from '../lib/image';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';
import { shareUrl } from '../lib/supabase';
import { qrSVG } from '../lib/qr';
import { copyText, safeName, saveFile, shareText } from '../lib/share';
import { sigImg } from '../lib/sigimg';
import { exportCertFile } from '../lib/exportCert';
import { BInbox, NudgePanel } from './Nudge';

type Run = (body: Record<string, unknown>, ok?: string) => Promise<boolean>;

export function Detail({ code }: { code: string }) {
  const auth = useAuth();
  const toast = useToast();
  const [det, setDet] = useState<DetailT | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // 혼자 하는 시연 약속: A·B 화면을 바꿔 가며 진행
  const [viewRole, setViewRole] = useState<'A' | 'B'>('A');

  const reload = useCallback(async () => {
    if (!auth.userId) { setDet(null); return; }
    try { setDet(await loadDetail(code, auth.userId)); } catch { setDet(null); }
  }, [code, auth.userId]);

  useEffect(() => { if (auth.ready) void reload(); }, [auth.ready, reload]);
  // 상대의 서명·신고를 놓치지 않게: 화면이 보일 때 20초마다, 그리고 다시 돌아올 때 새로고침
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 20000);
    const on = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', on);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', on); };
  }, [reload]);

  const run: Run = async (body, ok) => {
    if (!det) return false;
    setBusy(true);
    try {
      await action({ id: det.doc.id, version: det.doc.version, ...(isSolo(det) ? { as: viewRole } : {}), ...body });
      if (ok) toast(ok);
      await reload();
      window.scrollTo(0, 0);
      return true;
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '문제가 생겼어요. 다시 시도해 주세요.');
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') await reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!auth.ready || det === undefined) return <div className="empty"><span className="spin" /> 불러오는 중…</div>;
  if (!det) return <BEntry code={code} onJoined={reload} />;

  const solo = isSolo(det);
  const view: DetailT = solo ? { ...det, myRole: viewRole } : det;
  return <DetailBody det={view} run={run} busy={busy} reload={reload} demoBar={det.doc.isDemo ? <DemoBar det={det} solo={solo} viewRole={viewRole} setViewRole={setViewRole} reload={reload} /> : null} />;
}

const isSolo = (det: DetailT) => det.doc.isDemo && det.parties.length === 2 && !!det.parties[0].user_id && det.parties[0].user_id === det.parties[1].user_id;

/* ---------------- 시연 막대: 날짜 되감기 · A/B 화면 · 오전 9시 점검 즉시 실행 ---------------- */
function DemoBar({ det, solo, viewRole, setViewRole, reload }: { det: DetailT; solo: boolean; viewRole: 'A' | 'B'; setViewRole: (r: 'A' | 'B') => void; reload: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { doc } = det;
  const call = async (body: Record<string, unknown>, ok?: (r: Record<string, unknown>) => string) => {
    setBusy(true);
    try { const r = await action({ id: doc.id, version: doc.version, ...body }); if (ok) toast(ok(r), 5000); await reload(); }
    catch (e) { toast(e instanceof ApiError ? e.message : '문제가 생겼어요.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="card warn" style={{ marginTop: 12 }}>
      <div className="row between"><b><span className="demo-badge">시연</span> 시연 도구</b><span className="faint">시연 날짜 {korDate(docToday(doc))}</span></div>
      <div className="faint" style={{ margin: '10px 0 6px' }}>시간 되감기 (기한 기준)</div>
      <div className="chips">
        {DEMO_OFFSETS.map((o) => <button key={o.label} className={'chip ' + (doc.demoOffset === o.v ? 'on' : '')} disabled={busy} onClick={() => call({ action: 'demo_offset', offset: o.v })}>{o.label}</button>)}
      </div>
      {solo && (<>
        <div className="faint" style={{ margin: '10px 0 6px' }}>화면 전환 (혼자 시연: 같은 계정이 두 역할)</div>
        <div className="seg">
          <button className={viewRole === 'A' ? 'on' : ''} onClick={() => setViewRole('A')}>A 작성자 · {doc.aName}</button>
          <button className={viewRole === 'B' ? 'on' : ''} onClick={() => setViewRole('B')}>B 상대방 · {doc.bName}</button>
        </div>
      </>)}
      <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={() => call({ action: 'demo_cron' }, (r) => `오전 9시 점검 실행: ${r.result} · 발송 ${r.sent ?? 0}건`)}>{busy ? <span className="spin" /> : '오전 9시 점검 지금 실행 (알림 실제 발송)'}</button>
      <p className="faint" style={{ marginTop: 6 }}>시연 기록에는 실제 서버 시각과 시연 날짜가 함께 남아요. 시연 알림은 밤에도 바로 가요.</p>
    </div>
  );
}

function DetailBody({ det, run, busy, reload, demoBar }: { det: DetailT; run: Run; busy: boolean; reload: () => Promise<void>; demoBar: React.ReactNode }) {
  const { doc, myRole } = det;
  const st = STATUS[doc.status];
  return (
    <>
      <div className="row between" style={{ marginTop: 8 }}>
        <button className="btn small ghost" onClick={() => go('/')}>← 내 약속</button>
        <span className="faint">{myRole === 'A' ? '내가 작성' : '내가 지킬 약속'}</span>
      </div>
      <h1>{doc.title}</h1>
      <div className="row">
        <span className={'pill ' + st.c}>{st.t}</span><span className="pill">{TPL[doc.tpl].name}</span>
        {doc.isDemo && <span className="demo-badge">시연</span>}
        {det.legacy && <span className="pill">이전 버전에서 가져옴</span>}
        <span className="faint">{doc.aName} → {doc.bName}</span>
      </div>
      {demoBar}

      {(doc.status === 'pending_b' || doc.status === 'revise') && (myRole === 'A' ? <PendingA det={det} run={run} busy={busy} /> : <PendingB det={det} run={run} busy={busy} />)}
      {doc.status === 'cancelled' && <div className="card flat"><h3>취소된 약속이에요</h3><p className="muted">작성자가 서명 요청을 취소했어요. 기록은 아래에 남아 있어요.</p></div>}
      {doc.status === 'declined' && <div className="card warn flat"><h3>{doc.bName}님이 서명을 거절했어요</h3><p className="muted">기록은 아래에 남아 있어요. 필요하면 내용을 다시 정리해 새 약속을 만들어 주세요.</p></div>}
      {['active', 'reported', 'done'].includes(doc.status) && <ActiveView det={det} run={run} busy={busy} reload={reload} />}

      <CertCard det={det} />
      <Timeline events={det.events} names={{ a: doc.aName, b: doc.bName }} />
    </>
  );
}

/* ---------------- 상대방(B) 첫 진입: 미리보기 → 동의 → 로그인 → 연결 ---------------- */
function BEntry({ code, onJoined }: { code: string; onJoined: () => Promise<void> }) {
  const auth = useAuth();
  const toast = useToast();
  const [pv, setPv] = useState<PublicPreview | null>(null);
  const [err, setErr] = useState('');
  const consentKey = 'keep.consent.' + code;
  const [agree, setAgree] = useState(() => { try { return sessionStorage.getItem(consentKey) === '1'; } catch { return false; } });
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const tried = useRef(false);
  const [mismatch, setMismatch] = useState(false);

  useEffect(() => { preview(code).then(setPv).catch((e) => setErr(e instanceof ApiError ? e.message : '약속을 불러오지 못했어요.')); }, [code]);

  const claim = useCallback(async () => {
    setBusy(true);
    try {
      await action({ action: 'claim', code, consent: true });
      try { sessionStorage.removeItem(consentKey); } catch { /* 무시 */ }
      await onJoined();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_MISMATCH') setMismatch(true);
      toast(e instanceof ApiError ? e.message : '연결하지 못했어요.', 6000);
    } finally { setBusy(false); }
  }, [code, consentKey, onJoined, toast]);

  // 로그인하고 돌아오면(동의는 이미 함) 자동으로 이어서 연결
  useEffect(() => {
    if (auth.userId && agree && pv && !tried.current) { tried.current = true; void claim(); }
  }, [auth.userId, agree, pv, claim]);

  if (err) return <div className="card warn" style={{ marginTop: 20 }}><h2>약속을 열 수 없어요</h2><p className="muted">{err}</p><button className="btn block" onClick={() => go('/')}>홈으로</button></div>;
  if (!pv) return <div className="empty"><span className="spin" /> 증서를 불러오는 중…</div>;

  const open = pv.status === 'pending_b' || pv.status === 'revise';
  const doc: CertDoc = {
    code: pv.code, tpl: pv.tpl, title: pv.title, aName: pv.aName, bName: pv.bName, amount: pv.amount, interestRate: pv.interestRate,
    lateInterestRate: pv.lateInterestRate, repayAccount: pv.hasAccount ? '로그인 후 표시' : '', item: pv.item, task: pv.task, deadline: pv.deadline,
    method: pv.method, penalty: pv.penalty, memo: pv.hasMemo ? '로그인 후 표시' : '', installments: [], amendments: [], sigA: null, sigB: null, createdAt: pv.createdAt,
  };
  return (
    <>
      <div className="card seal" style={{ marginTop: 16 }}>
        <h2>{pv.aName}님이 약속증서 확인을 요청했어요</h2>
        <p className="muted">내용을 먼저 확인해 보세요. 이름 일부와 계좌는 동의·로그인 뒤에 보여요.</p>
        <div className="row" style={{ marginBottom: 8 }}>{pv.signedA && <span className="pill ok">작성자 서명 완료</span>}<span className="pill">{TPL[pv.tpl].name}</span></div>
        <Certificate doc={doc} revealAccount />
      </div>
      {!open ? (
        <div className="card flat"><p className="muted">{pv.status === 'active' || pv.status === 'done' || pv.status === 'reported' ? '이미 서명이 끝난 약속이에요. 당사자 계정으로 로그인하면 볼 수 있어요.' : '지금은 서명을 받을 수 없는 약속이에요.'}</p>
          {!auth.userId && <button className="btn block" onClick={() => setLogin(true)}>로그인</button>}</div>
      ) : (
        <div className="card">
          <h2>1. 개인정보 수집·이용 동의</h2>
          <ConsentBox />
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); try { sessionStorage.setItem(consentKey, e.target.checked ? '1' : '0'); } catch { /* 무시 */ } }} /> 위 내용에 동의합니다. (필수)</label>
          <h2 style={{ marginTop: 16 }}>2. 로그인하고 서명하기</h2>
          <p className="muted">본인 확인을 위해 로그인한 뒤 서명·수정 요청·서명 거절 중에 고를 수 있어요.</p>
          {pv.bEmailHint && <div className="notice">🔒 작성자가 지정한 이메일(<b>{pv.bEmailHint}</b>)로 로그인해야 서명할 수 있어요.</div>}
          {mismatch && auth.userId && <button className="btn block" style={{ marginTop: 8 }} onClick={async () => { await auth.signOut(); setMismatch(false); tried.current = false; setLogin(true); }}>다른 이메일로 다시 로그인</button>}
          {auth.userId
            ? <button className="btn seal block" disabled={!agree || busy} onClick={claim}>{busy ? <span className="spin" /> : '계속하기'}</button>
            : <button className="btn seal block" disabled={!agree} onClick={() => setLogin(true)}>로그인하고 계속하기</button>}
          {!agree && <p className="faint" style={{ marginTop: 6 }}>동의하지 않으면 서명할 수 없고, 아무 정보도 저장되지 않아요.</p>}
        </div>
      )}
      {login && <LoginSheet reason="서명은 본인 확인을 위해 로그인한 뒤에 할 수 있어요." onClose={() => setLogin(false)} />}
    </>
  );
}

/* ---------------- 서명 대기 ---------------- */
function PendingA({ det, run, busy }: { det: DetailT; run: Run; busy: boolean }) {
  const toast = useToast();
  const { doc } = det;
  const url = shareUrl(doc.code);
  const msg = `[키프] ${doc.aName}님이 '${doc.title}' 약속증서 확인을 요청했어요. 내용 확인 후 서명해 주세요 👉 ${url}`;
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (doc.status === 'revise') {
    return (
      <div className="card warn">
        <h3>{doc.bName}님이 수정을 요청했어요</h3>
        <div className="quote">{det.reviseNote}</div>
        <div style={{ marginTop: 10 }}><button className="btn primary block" onClick={() => go('/edit/' + doc.code)}>내용 고치고 다시 서명하기</button></div>
      </div>
    );
  }
  const Bp = det.parties.find((p) => p.role === 'B');
  const linked = Bp?.user_id;
  return (
    <div className="card seal">
      <h2>{doc.bName}님에게 서명 요청 보내기</h2>
      <p className="muted">상대가 휴대폰 카메라로 QR을 찍거나, 카톡으로 받은 링크를 열면 내용을 확인하고 서명할 수 있어요.</p>
      <div className="qrbig" dangerouslySetInnerHTML={{ __html: qrSVG(url, 'M') }} />
      <div className="linkrow"><span className="grow">{url.replace(/^https:\/\//, '')}</span></div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn kakao grow" onClick={async () => { const r = await shareText(msg); if (r === 'copied') toast('복사했어요. 카톡에 붙여넣어 보내세요.'); }}>카톡 등으로 보내기</button>
        <button className="btn" onClick={async () => toast((await copyText(msg)) ? '복사했어요.' : '복사가 막혀 있어요.')}>링크 복사</button>
      </div>
      <p className="faint" style={{ marginTop: 10 }}>{linked ? `${doc.bName}님이 링크를 열고 동의했어요${Bp?.linked_hint ? ` (계정 ${Bp.linked_hint})` : ''}. 서명을 기다리는 중이에요.` : '상대가 서명하면 이 화면이 자동으로 바뀌어요. 같은 약속을 카톡 안 브라우저에서 열어도 똑같이 보여요.'}</p>
      <p className="faint">{Bp?.expected_email ? `🔒 ${Bp.expected_email} 로 로그인한 사람만 서명할 수 있어요.` : '링크를 가진 사람은 누구나 상대방으로 서명할 수 있어요. 막으려면 \'서명 요청 취소\' 후 상대 이메일을 지정해 다시 만들어 주세요.'}</p>
      <div className="row end">
        {confirmCancel
          ? <><span className="faint">서명 요청을 취소할까요?</span><button className="btn small" onClick={() => setConfirmCancel(false)}>아니요</button><button className="btn small seal" disabled={busy} onClick={() => run({ action: 'cancel' }, '취소했어요.')}>취소하기</button></>
          : <button className="btn small ghost" onClick={() => setConfirmCancel(true)}>서명 요청 취소</button>}
      </div>
    </div>
  );
}

function PendingB({ det, run, busy }: { det: DetailT; run: Run; busy: boolean }) {
  const { doc } = det;
  const [mode, setMode] = useState<'' | 'sign' | 'revise' | 'decline'>('');
  const [note, setNote] = useState('');
  const [strokes, setStrokes] = useState<Strokes>([]);
  const [agree, setAgree] = useState(false);
  const toast = useToast();
  if (doc.status === 'revise') return <div className="card warn"><h3>수정 요청을 보냈어요</h3><div className="quote">{det.reviseNote}</div><p className="faint" style={{ marginTop: 8 }}>{doc.aName}님이 고치면 알려 드릴게요. 이 화면에서 바로 확인할 수 있어요.</p></div>;
  return (
    <div className="card seal">
      <h2>{doc.aName}님이 약속증서 서명을 요청했어요</h2>
      <p className="muted">내용이 맞는지 꼼꼼히 확인해 주세요. 아래 '약속증서'를 펼치면 전체를 볼 수 있어요.</p>
      <div style={{ margin: '12px 0' }}><Certificate doc={doc} id={doc.id} revealAccount flag={certFlag({ isDemo: doc.isDemo, legacy: det.legacy })} /></div>
      {mode === 'revise' && (<>
        <label className="f">어떤 부분을 고쳐야 하나요?</label>
        <textarea className="i" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="예: 금액이 25만원이에요 / 기한을 20일로 해 주세요" />
        <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={() => setMode('')}>취소</button><button className="btn primary grow" disabled={busy || !note.trim()} onClick={() => run({ action: 'revise', note }, '수정 요청을 보냈어요.')}>수정 요청 보내기</button></div>
      </>)}
      {mode === 'decline' && (<>
        <label className="f">거절 사유 (선택)</label>
        <input className="i" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="예: 이런 약속을 한 적이 없어요" />
        <div className="row" style={{ marginTop: 8 }}><button className="btn" onClick={() => setMode('')}>취소</button><button className="btn seal grow" disabled={busy} onClick={() => run({ action: 'decline', note }, '서명을 거절했어요.')}>서명 거절하기</button></div>
      </>)}
      {mode === 'sign' && (<>
        <h3 style={{ marginTop: 6 }}>{doc.bName} 서명</h3>
        <SignaturePad value={strokes} onChange={setStrokes} />
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> 위 약속 내용을 확인했고, 본인이 직접 서명합니다.</label>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => setMode('')}>취소</button>
          <button className="btn seal grow" disabled={busy} onClick={async () => {
            const sv = strokesToVector(strokes);
            if (!sv) return toast('서명을 해 주세요.');
            if (!agree) return toast('내용 확인에 체크해 주세요.');
            await run({ action: 'sign', signature: sv, agree: true, seenHash: doc.currentHash }, '증서가 확정됐어요!');
          }}>{busy ? <span className="spin" /> : '서명하고 증서 확정'}</button>
        </div>
      </>)}
      {!mode && (
        <div className="row">
          <button className="btn" onClick={() => setMode('revise')}>수정 요청</button>
          <button className="btn ghost" onClick={() => setMode('decline')}>서명 거절</button>
          <button className="btn seal grow" onClick={() => setMode('sign')}>내용 확인, 서명할게요</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- 진행·완료 ---------------- */
function ActiveView({ det, run, busy, reload }: { det: DetailT; run: Run; busy: boolean; reload: () => Promise<void> }) {
  const { doc, myRole } = det;
  const today = docToday(doc);
  const x = isYmd(doc.deadline) ? diffDays(today, doc.deadline) : 0;
  const stage = promiseStage(doc, today);
  if (doc.status === 'done') return <><DoneCard det={det} /><LedgerCard det={det} run={run} busy={busy} /></>;
  return (
    <>
      <div className="card">
        <div className="row between">
          <div><div className="faint">{TPL[doc.tpl].due} {korDate(doc.deadline)}</div><div className="big" style={x > 0 ? { color: 'var(--seal)' } : undefined}>{ddayLabel(today, doc.deadline)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="faint">{TPL[doc.tpl].what}</div><b style={{ fontSize: 17 }}>{subjectText(doc)}</b></div>
        </div>
        <div className="track">{STAGES.map((s) => <div key={s.n} className={'st ' + (stage > s.n ? 'done' : stage === s.n ? 'now' : '')}><div className="dot" />{s.label}<br />{s.name}</div>)}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn small" onClick={() => downloadIcs(doc)}>📅 캘린더에 기한 추가</button>
          {doc.groupId && myRole === 'A' && <button className="btn small ghost" onClick={() => go('/group/' + doc.groupId)}>정산 현황 보기</button>}
        </div>
      </div>
      <LedgerCard det={det} run={run} busy={busy} />
      {myRole === 'A' ? <APanel det={det} run={run} busy={busy} stage={stage} /> : <BPanel det={det} run={run} busy={busy} reload={reload} />}
    </>
  );
}

function APanel({ det, run, busy, stage }: { det: DetailT; run: Run; busy: boolean; stage: number }) {
  const { doc } = det;
  const pendingPay = det.payments.find((p) => p.confirmed_by_a === null);
  const pendingReqs = det.requests.filter((r) => r.status === 'pending');
  const expectAmt = doc.installments.find((i) => !i.paid)?.amount ?? doc.amount;
  return (
    <>
      {doc.status === 'reported' && (
        <div className="card ok">
          <h2>{doc.bName}님이 이행을 신고했어요</h2>
          {pendingPay?.amount ? (<>
            <p>보낸 금액 <b>{won(pendingPay.amount)}</b>{pendingPay.paid_on ? ' · ' + korDate(pendingPay.paid_on) : ''} {pendingPay.amount === expectAmt ? <span className="pill ok">약속 금액과 일치</span> : <span className="pill warn">금액 확인 필요</span>}</p>
            <p className="faint">통장·송금 앱에서 실제로 들어왔는지 확인한 뒤 눌러 주세요.</p>
          </>) : null}
          {pendingPay?.note && <div className="quote">{pendingPay.note}</div>}
          {pendingPay?.ai_reading && typeof pendingPay.ai_reading.readable === 'boolean' && <ProofView reading={pendingPay.ai_reading as ProofReading} />}
          {pendingPay?.ai_reading?.attached && <ProofLink id={doc.id} paymentId={pendingPay.id} />}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run({ action: 'reject' }, '아직 확인되지 않았다고 기록했어요.')}>아직이에요</button>
            <button className="btn primary grow" disabled={busy} onClick={() => run({ action: 'confirm' }, '확인했어요.')}>받았어요, 완료 처리</button>
          </div>
        </div>
      )}
      {pendingReqs.map((r) => (
        <div className="card warn" key={r.id}>
          <h2>{r.kind === 'extend' ? '기한 연장 요청' : '나눠서 이행 요청'}</h2>
          <p>{r.kind === 'extend' ? <>{korDate(doc.deadline)} → <b>{korDate(r.new_deadline)}</b></> : (r.installments || []).map((x, i) => <span key={i}>{i + 1}회 {korDate(x.date)} {won(x.amount)}<br /></span>)}</p>
          {r.note && <div className="quote">{r.note}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run({ action: 'answer', requestId: r.id, ok: false }, '거절했어요. 기존 기한이 유지돼요.')}>거절</button>
            <button className="btn primary grow" disabled={busy} onClick={() => run({ action: 'answer', requestId: r.id, ok: true }, '수락했어요. 증서에 변경 이력이 남았어요.')}>수락하고 증서에 반영</button>
          </div>
        </div>
      ))}
      {doc.status === 'active' && <NudgePanel det={det} run={run} busy={busy} stage={stage} />}
      {doc.status === 'active' && !pendingPay && (
        <div className="card flat"><div className="row between"><span className="muted">직접 받았나요?</span><button className="btn small" disabled={busy} onClick={() => run({ action: 'confirm' }, '완료 처리했어요.')}>이행 완료로 처리</button></div></div>
      )}
    </>
  );
}

function BPanel({ det, run, busy, reload }: { det: DetailT; run: Run; busy: boolean; reload: () => Promise<void> }) {
  const { doc } = det;
  const money = TPL[doc.tpl].kind === 'money';
  const next = doc.installments.find((x) => !x.paid);
  const expectAmt = next ? next.amount : doc.amount;
  const today = docToday(doc);
  const [paid, setPaid] = useState('');
  const [proof, setProof] = useState<ImageData64 | null>(null);
  const [reading, setReading] = useState<ProofReading | null>(null);
  const [reading_busy, setReadingBusy] = useState(false);
  const toast = useToast();
  const onProof = async (file: File) => {
    try {
      const img = await shrinkImage(file);
      setProof(img); setReading(null); setReadingBusy(true);
      const r = await ai<ProofReading>({ action: 'proof', id: doc.id, image: { mediaType: img.mediaType, data: img.data } });
      setReadingBusy(false);
      if (r.ai) {
        setReading(r.data);
        if (r.data.readable && r.data.amount && !paid) setPaid(String(r.data.amount));
        if (r.data.readable && r.data.date) setPaidOn(r.data.date);
      } else toast(aiReasonText(r.reason).replace('기본 방식으로 채웠어요', '금액과 날짜를 직접 적어 주세요'));
    } catch (e) { setReadingBusy(false); toast((e as Error).message); }
  };
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'extend' | 'split'>('extend');
  const [newDate, setNewDate] = useState(addDays(doc.deadline, 7));
  const [parts, setParts] = useState(2);
  const [every, setEvery] = useState(14);
  const [reqNote, setReqNote] = useState('');
  const paidNum = Number(paid.replace(/[^\d]/g, '')) || 0;
  return (
    <>
      <BInbox det={det} onChanged={reload} />
      {doc.status === 'reported' ? (
        <div className="card ok"><h2>이행을 신고했어요</h2><p className="muted">{doc.aName}님이 확인하면 약속이 완료돼요.</p></div>
      ) : (
        <div className="card ok">
          <h2>약속을 지켰나요?</h2>
          {money && (<>
            <p className="muted">보낸 금액과 날짜를 적으면 약속({won(expectAmt)})과 맞춰 봐요.</p>
            <div className="two">
              <div><label className="f">보낸 금액 (원)</label><input className="i" inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value.replace(/[^\d]/g, ''))} placeholder={String(expectAmt || '')} /></div>
              <div><label className="f">보낸 날짜</label><input className="i" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></div>
            </div>
            {paidNum > 0 && <p style={{ marginTop: 6 }}>{paidNum === expectAmt ? <span className="pill ok">약속 금액과 일치</span> : <span className="pill warn">약속 금액과 달라요</span>}</p>}
          </>)}
          {money && (<>
            <label className="f">송금 완료 화면 캡처 (선택)</label>
            {proof ? (
              <div className="row"><img src={proof.preview} alt="송금 캡처" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />
                <button className="btn small ghost" onClick={() => { setProof(null); setReading(null); }}>빼기</button>
                {reading_busy && <span className="faint"><span className="spin" /> AI가 읽는 중…</span>}</div>
            ) : (
              <label className="btn small">캡처 올리기<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onProof(f); }} /></label>
            )}
            {reading && <ProofView reading={reading} />}
          </>)}
          <label className="f">메모 (선택)</label>
          <input className="i" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={money ? '예: 토스로 보냈어!' : '예: 오늘 직접 돌려줬어'} />
          <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || reading_busy} onClick={() => run({ action: 'report', amount: paid, paidOn, note, proof: proof ? { mediaType: proof.mediaType, data: proof.data } : undefined, aiReading: reading || undefined }, `${doc.aName}님에게 이행 신고를 보냈어요.`)}>이행 완료 신고</button>
        </div>
      )}
      {det.requests.some((r) => r.status === 'pending') ? (
        <div className="card warn"><h3>요청을 보냈어요</h3><p className="muted">{doc.aName}님의 답을 기다리는 중이에요.</p></div>
      ) : doc.status === 'active' && (
        <div className="card">
          <h2>기한이 어렵다면</h2>
          <p className="muted">미루는 대신 먼저 말해요. 수락되면 증서에 변경 이력으로 남아요.</p>
          <div className="seg">
            <button className={kind === 'extend' ? 'on' : ''} onClick={() => setKind('extend')}>기한 연장</button>
            {money && <button className={kind === 'split' ? 'on' : ''} onClick={() => setKind('split')}>나눠서 이행</button>}
          </div>
          {kind === 'split' && money ? (<>
            <div className="two">
              <div><label className="f">몇 번에 나눌까요</label><select className="i" value={parts} onChange={(e) => setParts(+e.target.value)}>{[2, 3, 4].map((n) => <option key={n} value={n}>{n}회</option>)}</select></div>
              <div><label className="f">간격</label><select className="i" value={every} onChange={(e) => setEvery(+e.target.value)}>{[7, 14, 30].map((n) => <option key={n} value={n}>{n}일마다</option>)}</select></div>
            </div>
            <div className="faint" style={{ marginTop: 6 }}>{splitPlan(doc.amount || 0, parts, every, doc.deadline, today).map((p, i) => `${i + 1}회 ${shortDate(p.date)} ${won(p.amount)}`).join(' · ')}</div>
          </>) : (<>
            <label className="f">새 기한</label>
            <input className="i" type="date" value={newDate} min={addDays(doc.deadline, 1)} onChange={(e) => setNewDate(e.target.value)} />
          </>)}
          <label className="f">사유</label>
          <input className="i" value={reqNote} onChange={(e) => setReqNote(e.target.value)} maxLength={300} placeholder="예: 알바비가 일주일 늦게 들어와" />
          <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={async () => { if (await run({ action: 'request', kind, newDeadline: newDate, parts, every, note: reqNote }, `${doc.aName}님에게 요청을 보냈어요.`)) setReqNote(''); }}>요청 보내기</button>
        </div>
      )}
    </>
  );
}

function DoneCard({ det }: { det: DetailT }) {
  const { doc } = det;
  const ref = useRef<HTMLCanvasElement>(null);
  const doneAt = det.events.find((e) => e.type === 'done')?.created_at;
  const early = det.events.find((e) => e.type === 'done')?.payload?.early_days as number | null | undefined;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => drawCard(c, doc.title, doc.aName, doc.bName, korDate(doc.deadline), doneAt ? stamp(doneAt).slice(0, 10) : '');
    draw();
    document.fonts?.ready.then(draw).catch(() => {});
  }, [doc, doneAt]);
  return (
    <div className="card ok">
      <div className="row between"><div><div className="faint">지킴 완료</div><div className="big" style={{ color: 'var(--ok)' }}>✓</div></div><div style={{ textAlign: 'right' }}><div className="faint">완료일</div><b>{doneAt ? stamp(doneAt) : ''}</b></div></div>
      <p style={{ marginTop: 10 }}>{doc.bName}님이 약속을 지켰어요. {early != null ? (early > 0 ? `기한보다 ${early}일 일찍 지켰어요.` : early === 0 ? '기한 당일에 지켰어요.' : `기한보다 ${-early}일 늦었지만 지켰어요.`) : ''}</p>
      <canvas ref={ref} width={1080} height={1080} style={{ width: '100%', borderRadius: 12, marginTop: 6 }} />
      <button className="btn block" style={{ marginTop: 8 }} onClick={() => ref.current?.toBlob((b) => b && saveFile(`키프_약속지킴_${doc.code}.png`, b, 'image/png'), 'image/png')}>완료 카드 저장</button>
    </div>
  );
}

function drawCard(c: HTMLCanvasElement, title: string, a: string, b: string, due: string, done: string) {
  const x = c.getContext('2d')!, W = 1080;
  const rr = (l: number, t: number, w: number, h: number, r: number) => { x.beginPath(); x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r); x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath(); };
  x.fillStyle = '#f5f1ea'; x.fillRect(0, 0, W, W);
  x.fillStyle = '#fffdf9'; x.strokeStyle = '#e3d6bd'; x.lineWidth = 4; rr(70, 70, 940, 940, 40); x.fill(); x.stroke();
  x.save(); x.translate(540, 360); x.rotate(-0.12); x.strokeStyle = '#cf3d28'; x.lineWidth = 14; x.beginPath(); x.arc(0, 0, 170, 0, Math.PI * 2); x.stroke(); x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 145, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#cf3d28'; x.textAlign = 'center'; x.font = '800 92px "Nanum Myeongjo", serif'; x.fillText('지킴', 0, 10); x.font = '700 34px "IBM Plex Sans KR", sans-serif'; x.fillText('KEPT', 0, 70); x.restore();
  x.textAlign = 'center'; x.fillStyle = '#1f1b2d'; x.font = '700 54px "IBM Plex Sans KR", sans-serif'; x.fillText('약속을 지켰어요', 540, 640);
  x.font = '500 38px "IBM Plex Sans KR", sans-serif'; x.fillStyle = '#575265'; x.fillText(clip(title, 22), 540, 705);
  x.font = '500 34px "IBM Plex Sans KR", sans-serif'; x.fillText(`${a}  ·  ${b}`, 540, 765);
  x.fillStyle = '#8b8597'; x.font = '400 28px "IBM Plex Sans KR", sans-serif'; x.fillText(`${due} 약속 · ${done} 완료`, 540, 830);
  x.fillStyle = '#cf3d28'; x.font = '800 34px "Nanum Myeongjo", serif'; x.fillText('키프 Keep', 540, 930);
}

/* ---------------- 상환 장부 ---------------- */
function LedgerCard({ det, run, busy }: { det: DetailT; run: Run; busy: boolean }) {
  const { doc, myRole } = det;
  const l = ledgerOf(doc, det.payments);
  const [amt, setAmt] = useState('');
  const [on, setOn] = useState(docToday(doc));
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  if (!l) return null;
  const rows = det.payments.filter((p) => p.confirmed_by_a !== false);
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>상환 장부</h2><span className="faint">{Math.round(l.ratio * 100)}%</span></div>
      <div style={{ height: 10, borderRadius: 6, background: '#e4ddd1', margin: '10px 0 6px', overflow: 'hidden' }} role="progressbar" aria-valuenow={Math.round(l.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${l.ratio * 100}%`, height: '100%', background: 'var(--ok)', transition: 'width .3s' }} />
      </div>
      <div className="row between"><span>받은 금액 <b>{won(l.paid)}</b></span><span>남은 금액 <b style={l.remaining ? { color: 'var(--seal)' } : undefined}>{won(l.remaining)}</b></span></div>
      {l.pending > 0 && <p className="faint" style={{ margin: '4px 0 0' }}>확인 대기 {won(l.pending)}</p>}
      {doc.installments.length > 0 && <p className="faint" style={{ margin: '6px 0 0' }}>{doc.installments.map((x, i) => `${i + 1}회 ${shortDate(x.date)} ${won(x.amount)}${x.paid ? ' ✓' : ''}`).join(' · ')}</p>}
      {rows.length > 0 && (
        <div className="tl" style={{ marginTop: 12 }}>
          {[...rows].reverse().map((p) => (
            <div key={p.id} className={'ev ' + (p.confirmed_by_a ? 'ok' : '')}>
              <b>{won(p.amount) || '금액 없음'} {p.confirmed_by_a ? '받음' : '· 확인 대기'}</b>
              <time>{p.paid_on ? korDate(p.paid_on) : stamp(p.created_at)}</time>
              {p.note && <div>{p.note}</div>}
            </div>
          ))}
        </div>
      )}
      {myRole === 'A' && doc.status === 'active' && l.remaining > 0 && (!open
        ? <button className="btn small" style={{ marginTop: 6 }} onClick={() => setOpen(true)}>직접 받은 금액 기록</button>
        : (<>
          <div className="two">
            <div><label className="f">받은 금액 (원)</label><input className="i" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ''))} placeholder={String(l.remaining)} /></div>
            <div><label className="f">받은 날짜</label><input className="i" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          </div>
          <label className="f">메모 (선택)</label>
          <input className="i" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="예: 현금으로 받음" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => setOpen(false)}>취소</button>
            <button className="btn primary grow" disabled={busy || !amt} onClick={async () => { if (await run({ action: 'record_payment', amount: amt, paidOn: on, note }, '장부에 기록했어요.')) { setAmt(''); setNote(''); setOpen(false); } }}>기록하기</button>
          </div>
        </>))}
    </div>
  );
}

function downloadIcs(doc: DetailT['doc']) {
  const url = shareUrl(doc.code);
  const unpaid = doc.installments.filter((x) => !x.paid);
  const evs = unpaid.length
    ? unpaid.map((x) => ({ uid: `${doc.id}-${x.date}`, date: x.date, title: `키프: ${doc.title} ${doc.installments.indexOf(x) + 1}회차 ${won(x.amount)}`, description: `${doc.aName} → ${doc.bName} 분할 이행 기한`, url }))
    : [{ uid: doc.id, date: doc.deadline, title: `키프: ${doc.title} 기한`, description: `${doc.aName} → ${doc.bName} · ${TPL[doc.tpl].what} ${subjectText(doc)}`, url }];
  saveFile(`키프_${safeName(doc.title)}.ics`, makeIcs(evs), 'text/calendar');
}

/* ---------------- 송금 캡처 판독 결과 ---------------- */
function ProofView({ reading }: { reading: ProofReading }) {
  return (
    <div className="card flat" style={{ margin: '8px 0', padding: 12 }}>
      <AiBadge text="AI가 캡처에서 읽은 내용이에요, 확인해 주세요" />
      {reading.readable ? (
        <p style={{ margin: '8px 0 0' }}>
          보낸 금액 <b>{reading.amount ? won(reading.amount) : '읽지 못함'}</b>{reading.date ? ' · ' + korDate(reading.date) : ''}
          {reading.sender || reading.receiver ? <><br /><span className="faint">{reading.sender || '?'} → {reading.receiver || '?'}</span></> : null}
          <br />
          {reading.matchesExpected === true && <span className="pill ok">약속 금액과 일치</span>}
          {reading.matchesExpected === false && <span className="pill warn">약속 금액({won(reading.expected ?? null)})과 달라요</span>}
          {reading.withinRemaining === false && <span className="pill warn" style={{ marginLeft: 6 }}>남은 금액({won(reading.remaining ?? null)})보다 많아요</span>}
        </p>
      ) : <p className="faint" style={{ margin: '8px 0 0' }}>송금 완료 화면으로 읽히지 않아요. 금액과 날짜를 직접 적어 주세요.</p>}
      <p className="faint" style={{ margin: '4px 0 0' }}>최종 완료는 받은 사람이 통장에서 확인한 뒤 처리해요.</p>
    </div>
  );
}

function ProofLink({ id, paymentId }: { id: string; paymentId: string }) {
  const toast = useToast();
  return <button className="btn small" style={{ marginTop: 6 }} onClick={async () => {
    try { const r = await action<{ url: string }>({ action: 'proof_url', id, paymentId }); window.open(r.url, '_blank', 'noopener'); }
    catch (e) { toast(e instanceof ApiError ? e.message : '캡처를 열지 못했어요.'); }
  }}>첨부한 송금 캡처 보기</button>;
}

/* ---------------- 증서 카드 + 파일 저장 ---------------- */
function CertCard({ det }: { det: DetailT }) {
  const { doc } = det;
  const toast = useToast();
  const full = !!(doc.sigA && doc.sigB);
  const [pdfBusy, setPdfBusy] = useState(false);
  const savePdf = async () => {
    setPdfBusy(true);
    try {
      const base = import.meta.env.BASE_URL;
      const [{ buildEvidencePdf }, serif, sans, sigs, ev] = await Promise.all([
        import('../lib/evidencePdf'),
        fetch(base + 'fonts/KeepSerif-Regular.ttf').then((r) => { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }),
        fetch(base + 'fonts/KeepSans-Regular.ttf').then((r) => { if (!r.ok) throw new Error('font'); return r.arrayBuffer(); }),
        loadSignatures(doc.id, (doc.sigA?.sha || '') + (doc.sigB?.sha || '')),
        action<{ parties: { role: 'A' | 'B'; display_name: string; signed_at: string | null; signer_ip: string | null; signer_ua: string | null; consent_at: string | null; signature_sha256: string | null }[] }>({ action: 'evidence', id: doc.id }),
      ]);
      // 해시 사슬 검사
      let prev: string | null = null, chainOk = true;
      for (const e of det.events) { if (e.prev_hash !== prev || (await eventHash(prev, e.canon, e.created_at)) !== e.hash) { chainOk = false; break; } prev = e.hash; }
      // 첨부한 송금 캡처
      const proofs = [];
      for (const p of det.payments.filter((x) => x.ai_reading?.attached)) {
        try {
          const { url } = await action<{ url: string }>({ action: 'proof_url', id: doc.id, paymentId: p.id });
          const res = await fetch(url);
          proofs.push({ bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'image/jpeg', caption: `송금 캡처 · ${p.amount ? won(p.amount) : ''} · ${p.paid_on ? korDate(p.paid_on) : stamp(p.created_at)}` });
        } catch { /* 캡처 하나 실패해도 나머지는 만든다 */ }
      }
      const bytes = await buildEvidencePdf({
        doc: { ...doc },
        parties: ev.parties.map((p) => ({ role: p.role, name: p.display_name, signedAt: p.signed_at, ip: p.signer_ip, ua: p.signer_ua, consentAt: p.consent_at, sha: p.signature_sha256 })),
        sigs, events: det.events, chainOk, proofs, generatedAt: new Date(), flag: certFlag({ isDemo: doc.isDemo, legacy: det.legacy }),
      }, { serif, sans });
      saveFile(`키프_증거묶음_${safeName(doc.title)}.pdf`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), 'application/pdf');
      toast('PDF를 저장했어요. 다운로드 폴더를 확인하세요.');
    } catch {
      toast('PDF를 만들지 못했어요. 인터넷 연결을 확인해 주세요.');
    } finally {
      setPdfBusy(false);
    }
  };
  const save = async (withEvidence: boolean) => {
    try {
      const sigs = await loadSignatures(doc.id, (doc.sigA?.sha || '') + (doc.sigB?.sha || ''));
      let meta: Record<string, unknown>[] | undefined;
      if (withEvidence) {
        const ev = await action<{ parties: Record<string, unknown>[] }>({ action: 'evidence', id: doc.id });
        meta = ev.parties.map((p) => ({ 역할: p.role === 'A' ? '작성자' : '상대방', 이름: p.display_name, 서명시각: p.signed_at ? stamp(String(p.signed_at)) : '-', '접속 IP(참고용)': p.signer_ip || '-', 기기: p.signer_ua || '-', 동의시각: p.consent_at ? stamp(String(p.consent_at)) : '-', 서명지문: p.signature_sha256 || '-' }));
      }
      const html = exportCertFile(doc, { sigImgA: sigImg(sigs.A), sigImgB: sigImg(sigs.B), events: withEvidence ? det.events : undefined, meta, flag: certFlag({ isDemo: doc.isDemo, legacy: det.legacy }) });
      saveFile(`키프_${withEvidence ? '증거묶음' : '증서'}_${safeName(doc.title)}.html`, html, 'text/html');
      toast('저장했어요. 다운로드 폴더를 확인하세요.');
    } catch {
      toast('저장하지 못했어요.');
    }
  };
  return (
    <details className="card cert-d" open={doc.status === 'pending_b' && det.myRole === 'A' ? false : undefined}>
      <summary>약속증서 {full && doc.currentHash ? <span className="pill ok" style={{ marginLeft: 'auto', marginRight: 8 }}>확인코드 {shortCode(doc.currentHash)}</span> : null}</summary>
      <div style={{ marginTop: 12 }}><Certificate doc={doc} id={doc.id} revealAccount flag={certFlag({ isDemo: doc.isDemo, legacy: det.legacy })} /></div>
      {full && <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => save(false)}>증서 파일 저장</button>
        <button className="btn small" onClick={() => save(true)}>증거 묶음(HTML)</button>
        <button className="btn small primary" disabled={pdfBusy} onClick={savePdf}>{pdfBusy ? <><span className="spin" /> PDF 만드는 중…</> : '증거 묶음 PDF'}</button>
      </div>}
    </details>
  );
}
