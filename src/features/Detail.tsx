import { useCallback, useEffect, useRef, useState } from 'react';
import { STAGES, STATUS, TPL } from '@domain/templates.ts';
import { addDays, ddayLabel, diffDays, isYmd, korDate, kstToday, shortDate, stamp } from '@domain/dates.ts';
import { shortCode } from '@domain/canonical.ts';
import { strokesToVector } from '@domain/signature.ts';
import { promiseStage, splitPlan, subjectText } from '@domain/progress.ts';
import { clip, won } from '@domain/korean.ts';
import type { CertDoc } from '@domain/certificate.ts';
import { Certificate } from '../components/Certificate';
import { SignaturePad, type Strokes } from '../components/SignaturePad';
import { LoginSheet } from '../components/LoginSheet';
import { ConsentBox } from '../components/Consent';
import { Timeline } from '../components/Timeline';
import { action, ApiError, loadDetail, loadSignatures, preview, type Detail as DetailT, type PublicPreview } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';
import { shareUrl } from '../lib/supabase';
import { qrSVG } from '../lib/qr';
import { copyText, safeName, saveFile, shareText } from '../lib/share';
import { sigImg } from '../lib/sigimg';
import { exportCertFile } from '../lib/exportCert';

type Run = (body: Record<string, unknown>, ok?: string) => Promise<boolean>;

export function Detail({ code }: { code: string }) {
  const auth = useAuth();
  const toast = useToast();
  const [det, setDet] = useState<DetailT | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

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
      await action({ id: det.doc.id, version: det.doc.version, ...body });
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

      {(doc.status === 'pending_b' || doc.status === 'revise') && (myRole === 'A' ? <PendingA det={det} run={run} busy={busy} /> : <PendingB det={det} run={run} busy={busy} />)}
      {doc.status === 'cancelled' && <div className="card flat"><h3>취소된 약속이에요</h3><p className="muted">작성자가 서명 요청을 취소했어요. 기록은 아래에 남아 있어요.</p></div>}
      {doc.status === 'declined' && <div className="card warn flat"><h3>{doc.bName}님이 서명을 거절했어요</h3><p className="muted">기록은 아래에 남아 있어요. 필요하면 내용을 다시 정리해 새 약속을 만들어 주세요.</p></div>}
      {['active', 'reported', 'done'].includes(doc.status) && <ActiveView det={det} run={run} busy={busy} />}

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

  useEffect(() => { preview(code).then(setPv).catch((e) => setErr(e instanceof ApiError ? e.message : '약속을 불러오지 못했어요.')); }, [code]);

  const claim = useCallback(async () => {
    setBusy(true);
    try {
      await action({ action: 'claim', code, consent: true });
      try { sessionStorage.removeItem(consentKey); } catch { /* 무시 */ }
      await onJoined();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '연결하지 못했어요.');
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
  const linked = det.parties.find((p) => p.role === 'B')?.user_id;
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
      <p className="faint" style={{ marginTop: 10 }}>{linked ? `${doc.bName}님이 링크를 열고 동의했어요. 서명을 기다리는 중이에요.` : '상대가 서명하면 이 화면이 자동으로 바뀌어요. 같은 약속을 카톡 안 브라우저에서 열어도 똑같이 보여요.'}</p>
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
      <div style={{ margin: '12px 0' }}><Certificate doc={doc} id={doc.id} revealAccount /></div>
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
function ActiveView({ det, run, busy }: { det: DetailT; run: Run; busy: boolean }) {
  const { doc, myRole } = det;
  const today = kstToday();
  const x = isYmd(doc.deadline) ? diffDays(today, doc.deadline) : 0;
  const stage = promiseStage(doc, today);
  if (doc.status === 'done') return <DoneCard det={det} />;
  return (
    <>
      <div className="card">
        <div className="row between">
          <div><div className="faint">{TPL[doc.tpl].due} {korDate(doc.deadline)}</div><div className="big" style={x > 0 ? { color: 'var(--seal)' } : undefined}>{ddayLabel(today, doc.deadline)}</div></div>
          <div style={{ textAlign: 'right' }}><div className="faint">{TPL[doc.tpl].what}</div><b style={{ fontSize: 17 }}>{subjectText(doc)}</b></div>
        </div>
        <div className="track">{STAGES.map((s) => <div key={s.n} className={'st ' + (stage > s.n ? 'done' : stage === s.n ? 'now' : '')}><div className="dot" />{s.label}<br />{s.name}</div>)}</div>
      </div>
      {myRole === 'A' ? <APanel det={det} run={run} busy={busy} stage={stage} /> : <BPanel det={det} run={run} busy={busy} stage={stage} />}
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
      <div className="card">
        <h2>재촉{stage ? ' · ' + STAGES[stage - 1].name : ''}</h2>
        <p className="muted">
          {stage === 0 && `아직 여유가 있어요. 기한 3일 전부터 ${doc.bName}님에게 알림이 가요. 1차 재촉은 기한 3일 뒤(D+3)에 열려요.`}
          {(stage === 1 || stage === 2) && `${doc.bName}님에게 ${stage === 1 ? '기한 3일 전 사전 알림이' : '오늘 약속일 알림이'} 가요. 1차 재촉은 기한 3일 뒤(D+3)에 열려요.`}
          {stage >= 3 && '재촉할 때예요. 알림·재촉 메시지 보내기는 다음 업데이트(알림 기능)에서 열려요.'}
        </p>
      </div>
      {doc.status === 'active' && !pendingPay && (
        <div className="card flat"><div className="row between"><span className="muted">직접 받았나요?</span><button className="btn small" disabled={busy} onClick={() => run({ action: 'confirm' }, '완료 처리했어요.')}>이행 완료로 처리</button></div></div>
      )}
    </>
  );
}

function BPanel({ det, run, busy, stage }: { det: DetailT; run: Run; busy: boolean; stage: number }) {
  const { doc } = det;
  const money = TPL[doc.tpl].kind === 'money';
  const next = doc.installments.find((x) => !x.paid);
  const expectAmt = next ? next.amount : doc.amount;
  const today = kstToday();
  const [paid, setPaid] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'extend' | 'split'>('extend');
  const [newDate, setNewDate] = useState(addDays(doc.deadline, 7));
  const [parts, setParts] = useState(2);
  const [every, setEvery] = useState(14);
  const [reqNote, setReqNote] = useState('');
  const inbox: { t: string; text: string }[] = [];
  if (stage >= 1) inbox.push({ t: 'D-3 · 키프', text: `${korDate(doc.deadline)}까지 ${doc.aName}님과의 약속이 있어요. 미리 준비해 주세요.` });
  if (stage >= 2) inbox.push({ t: 'D-day · 키프', text: '오늘이 약속일이에요. 지켰다면 아래에서 이행 완료를 신고해 주세요.' });
  const paidNum = Number(paid.replace(/[^\d]/g, '')) || 0;
  return (
    <>
      <div className="card inbox"><h2>받은 알림</h2>
        {inbox.length ? [...inbox].reverse().map((m) => <div className="msg" key={m.t}><small>{m.t}</small>{m.text}</div>) : <p className="muted">아직 알림이 없어요. 기한 3일 전부터 알림이 가요.</p>}
      </div>
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
          <label className="f">메모 (선택)</label>
          <input className="i" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={money ? '예: 토스로 보냈어!' : '예: 오늘 직접 돌려줬어'} />
          <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy} onClick={() => run({ action: 'report', amount: paid, paidOn, note }, `${doc.aName}님에게 이행 신고를 보냈어요.`)}>이행 완료 신고</button>
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

/* ---------------- 증서 카드 + 파일 저장 ---------------- */
function CertCard({ det }: { det: DetailT }) {
  const { doc } = det;
  const toast = useToast();
  const full = !!(doc.sigA && doc.sigB);
  const save = async (withEvidence: boolean) => {
    try {
      const sigs = await loadSignatures(doc.id, (doc.sigA?.sha || '') + (doc.sigB?.sha || ''));
      let meta: Record<string, unknown>[] | undefined;
      if (withEvidence) {
        const ev = await action<{ parties: Record<string, unknown>[] }>({ action: 'evidence', id: doc.id });
        meta = ev.parties.map((p) => ({ 역할: p.role === 'A' ? '작성자' : '상대방', 이름: p.display_name, 서명시각: p.signed_at ? stamp(String(p.signed_at)) : '-', IP: p.signer_ip || '-', 기기: p.signer_ua || '-', 동의시각: p.consent_at ? stamp(String(p.consent_at)) : '-', 서명지문: p.signature_sha256 || '-' }));
      }
      const html = exportCertFile(doc, { sigImgA: sigImg(sigs.A), sigImgB: sigImg(sigs.B), events: withEvidence ? det.events : undefined, meta });
      saveFile(`키프_${withEvidence ? '증거묶음' : '증서'}_${safeName(doc.title)}.html`, html, 'text/html');
      toast('저장했어요. 다운로드 폴더를 확인하세요.');
    } catch {
      toast('저장하지 못했어요.');
    }
  };
  return (
    <details className="card cert-d" open={doc.status === 'pending_b' && det.myRole === 'A' ? false : undefined}>
      <summary>약속증서 {full && doc.currentHash ? <span className="pill ok" style={{ marginLeft: 'auto', marginRight: 8 }}>확인코드 {shortCode(doc.currentHash)}</span> : null}</summary>
      <div style={{ marginTop: 12 }}><Certificate doc={doc} id={doc.id} revealAccount /></div>
      {full && <div className="row" style={{ marginTop: 10 }}><button className="btn small" onClick={() => save(false)}>증서 파일 저장</button><button className="btn small" onClick={() => save(true)}>증거 묶음 저장</button></div>}
    </details>
  );
}
