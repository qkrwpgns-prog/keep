import { useEffect, useMemo, useState } from 'react';
import { RELATIONS, STAGES, TONES } from '@domain/templates.ts';
import { korDate, kstToday, stamp } from '@domain/dates.ts';
import { checkBanned, noticeText, nudgeBank, type NudgeOption } from '@domain/nudge.ts';
import { setMuted, action, ai, aiNoticeStream, aiReasonText, ApiError, type Detail } from '../lib/api';
import { AiBadge } from '../components/AiBadge';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { shareUrl } from '../lib/supabase';
import { safeName, saveFile, shareText } from '../lib/share';

type Run = (body: Record<string, unknown>, ok?: string) => Promise<boolean>;

/** 이번 기한(연장되면 새로 시작)의 재촉 기록 */
const current = (det: Detail) => det.nudges.filter((n) => n.deadline_version === det.doc.deadlineVersion);

/** A: 재촉 패널 (D+3·D+7 메시지, D+14 이행 촉구서). 단계마다 한 번, 내가 확인한 뒤에만 발송 */
export function NudgePanel({ det, run, busy, stage }: { det: Detail; run: Run; busy: boolean; stage: number }) {
  const { doc } = det;
  const toast = useToast();
  const today = kstToday();
  const sent = (n: number) => current(det).find((x) => x.stage === n && x.status === 'sent');
  const [rel, setRel] = useState<string>('친구');
  const [tone, setTone] = useState(2);
  // 20초마다 새로고침돼도 고치던 문구가 지워지지 않게, 고른 안·관계·어조가 바뀔 때만 다시 채운다
  const { tpl, amount, item, task, bName, deadline } = doc;
  const bank = useMemo(() => (stage === 3 || stage === 4 ? nudgeBank({ tpl, amount, item, task, bName, deadline }, stage, tone, rel, today) : []), [tpl, amount, item, task, bName, deadline, stage, tone, rel, today]);
  const [aiOpts, setAiOpts] = useState<NudgeOption[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const opts = aiOpts || bank;
  const [pick, setPick] = useState(0);
  const [text, setText] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setText(opts[pick]?.text || ''); }, [pick, tone, rel, stage, aiOpts]);
  useEffect(() => { setAiOpts(null); }, [tone, rel]);
  const aiRewrite = async () => {
    setAiBusy(true);
    const r = await ai<NudgeOption[]>({ action: 'nudge', id: doc.id, rel, tone });
    setAiBusy(false);
    if (r.ai) { setAiOpts(r.data); setPick(0); } else toast(aiReasonText(r.reason).replace('채웠어요', '보여드려요'));
  };
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeAi, setNoticeAi] = useState(false);
  const aiNotice = async () => {
    const before = notice;
    setNoticeBusy(true); setNotice('');
    let acc = '';
    const r = await aiNoticeStream(doc.id, (t) => { acc += t; setNotice(acc); });
    setNoticeBusy(false);
    if ('ok' in r) {
      let t = r.text.replace(/[*#`]+/g, '').trim();
      if (!t.includes('법률 자문이 아닙니다')) t += '\n\n※ 본 문서는 당사자 간 약속 기록을 바탕으로 작성한 안내문이며 법률 자문이 아닙니다.';
      if (checkBanned(t)) { setNotice(before); toast(aiReasonText('BANNED')); return; }
      setNotice(t); setNoticeAi(true);
    } else { setNotice(before); toast(aiReasonText(r.reason)); }
  };
  const nudgeCount = current(det).filter((x) => x.status === 'sent' && x.stage < 5).length;
  const B = det.parties.find((p) => p.role === 'B');
  const [notice, setNotice] = useState(() => noticeText({ ...doc, bSignedAt: B?.signed_at ? new Date(B.signed_at).toISOString() : undefined }, nudgeCount, today));
  const link = shareUrl(doc.code);
  const shareKakao = async (msg: string) => {
    const r = await shareText(`${msg}\n\n[키프] 약속 확인·연장 요청·이행 신고 👉 ${link}`);
    if (r === 'copied') toast('복사했어요. 카톡에 붙여넣어 보내세요.');
  };
  const banned = checkBanned(stage === 5 ? notice : text);

  if (stage === 0) return <div className="card"><h2>재촉</h2><p className="muted">아직 여유가 있어요. 기한 3일 전 오전 9시에 {doc.bName}님에게 알림이 가요. 1차 재촉은 기한 3일 뒤(D+3)에 열려요.</p></div>;
  if (stage <= 2) return <div className="card"><h2>재촉 · {STAGES[stage - 1].name}</h2><p className="muted">{doc.bName}님에게 {stage === 1 ? '기한 3일 전 알림' : '약속 당일 알림'}이 자동으로 가요(앱 알림·이메일). 1차 재촉은 기한 3일 뒤(D+3)에 열려요.</p></div>;

  if (stage === 3 || stage === 4) {
    const s = sent(stage);
    if (s) return (
      <div className="card">
        <h2>재촉 · {STAGES[stage - 1].name} 보냄</h2>
        <div className="inbox"><div className="msg"><small>{stamp(s.sent_at || s.created_at)} · {s.relation} · 어조 {s.tone}/5</small>{s.message}</div></div>
        <p className="faint" style={{ marginTop: 8 }}>{doc.bName}님에게 앱 알림·이메일로 보냈어요. 상대가 알림을 꺼 두었을 수도 있으니 카톡으로도 보내 보세요. 재촉은 단계마다 한 번만 보낼 수 있어요. {stage === 3 ? '다음은 D+7 2차 재촉이에요.' : '다음은 D+14 공식 통지예요.'}</p>
        <button className="btn kakao block" style={{ marginTop: 8 }} onClick={() => shareKakao(s.message || '')}>카톡으로도 보내기</button>
      </div>
    );
    return (
      <div className="card seal">
        <h2>재촉할 때예요 · {STAGES[stage - 1].name}</h2>
        <p className="muted">관계와 어조를 고르면 메시지 3안을 보여줘요. 고친 뒤 <b>내가 확인하고 보내기</b>를 눌러야 {doc.bName}님에게 가요.</p>
        <div className="two">
          <div><label className="f">관계</label><select className="i" value={rel} onChange={(e) => { setRel(e.target.value); setPick(0); }}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div><label className="f">어조 <span className="faint">{TONES[tone]}</span></label><input type="range" min={1} max={5} step={1} value={tone} onChange={(e) => { setTone(+e.target.value); setPick(0); }} style={{ width: '100%', marginTop: 12, accentColor: 'var(--seal)' }} /></div>
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          {aiOpts ? <AiBadge text="AI가 쓴 문구예요, 확인해 주세요" /> : <span className="faint">기본 문구</span>}
          <button className="btn small" disabled={aiBusy} onClick={aiRewrite}>{aiBusy ? <span className="spin" /> : '✦ AI로 문구 만들기'}</button>
        </div>
        {opts.map((o, i) => <button key={i + o.label} className={'opt ' + (pick === i ? 'on' : '')} onClick={() => setPick(i)}><small>{o.label}</small>{o.text}</button>)}
        <label className="f">보낼 메시지 (고칠 수 있어요)</label>
        <textarea className="i" style={{ minHeight: 96 }} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        {banned && <div className="err">{banned}으로 보일 수 있는 표현이 있어요. 관계를 지키면서 약속만 분명히 말해 주세요.</div>}
        <button className="btn seal block" style={{ marginTop: 10 }} disabled={busy || !text.trim() || !!banned}
          onClick={() => run({ action: 'nudge_send', stage, text: text.trim(), tone, rel, aiUsed: !!aiOpts }, `${doc.bName}님에게 보냈어요.`)}>내가 확인하고 보내기</button>
      </div>
    );
  }

  const s = sent(5);
  if (s) return (
    <div className="card">
      <h2>공식 통지 · 이행 촉구서 보냄</h2>
      <div className="inbox"><div className="msg" style={{ maxHeight: 260, overflow: 'auto' }}>{s.message}</div></div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => saveFile(`키프_이행촉구서_${safeName(doc.title)}.txt`, s.message || '', 'text/plain')}>촉구서 파일 저장</button>
        <button className="btn small kakao" onClick={() => shareKakao(`[이행 촉구서] ${doc.title}\n${korDate(today)} 이메일과 키프로 이행 촉구서를 보냈어요. 키프에서 전문을 확인해 주세요.`)}>카톡으로 알리기</button>
      </div>
      <p className="faint" style={{ marginTop: 8 }}>이후에도 이행되지 않으면 '증거 묶음 저장'으로 기록을 보관하고, 지급명령·소액사건심판 같은 절차는 대한법률구조공단(국번 없이 132) 등 전문가와 상담하세요.</p>
    </div>
  );
  return (
    <div className="card seal">
      <h2>공식 통지 · 이행 촉구서</h2>
      <p className="muted">기한이 14일 지났어요. 증서와 재촉 기록으로 초안을 채웠어요. 위협이 아닌, 정리된 마지막 요청이에요. 고친 뒤 확정하면 {doc.bName}님에게 앱 알림·이메일로 전문이 가요.</p>
      <div className="row between" style={{ margin: '6px 0' }}>
        {noticeAi ? <AiBadge text="AI가 쓴 초안이에요, 사실과 맞는지 확인해 주세요" /> : <span className="faint">기본 초안</span>}
        <button className="btn small" disabled={noticeBusy} onClick={aiNotice}>{noticeBusy ? <><span className="spin" /> 작성 중…</> : '✦ AI 초안 받기'}</button>
      </div>
      <textarea className="i" style={{ minHeight: 320, fontSize: 13.5 }} value={notice} maxLength={4000} readOnly={noticeBusy} onChange={(e) => setNotice(e.target.value)} />
      {banned && <div className="err">{banned}으로 보일 수 있는 표현이 있어요. 표현을 바꿔 주세요.</div>}
      {!noticeBusy && !notice.includes('법률 자문이 아닙니다') && <div className="err">'법률 자문이 아닙니다' 문구는 지울 수 없어요.</div>}
      <button className="btn seal block" style={{ marginTop: 10 }} disabled={busy || noticeBusy || !!banned || !notice.includes('법률 자문이 아닙니다')}
        onClick={() => run({ action: 'notice_send', text: notice, aiUsed: noticeAi }, '이행 촉구서를 보냈어요.')}>확정하고 보내기</button>
    </div>
  );
}

/** B: 받은 알림함 + 이 약속 알림 끄기·신고 */
export function BInbox({ det, onChanged }: { det: Detail; onChanged: () => Promise<void> }) {
  const { doc } = det;
  const auth = useAuth();
  const toast = useToast();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');
  const items = current(det).filter((n) => n.status === 'auto_sent' || n.status === 'sent').map((n) => ({
    at: n.sent_at || n.created_at,
    who: n.status === 'auto_sent' ? '키프' : doc.aName,
    text: n.status === 'auto_sent'
      ? (n.stage === 1 ? `${korDate(doc.deadline)}까지 ${doc.aName}님과의 약속이 있어요. 미리 준비해 주세요.` : '오늘이 약속일이에요. 지켰다면 아래에서 이행 완료를 신고해 주세요.')
      : n.message || '',
    label: n.stage === 5 ? '이행 촉구서' : STAGES[n.stage - 1].label,
  })).reverse();
  return (
    <div className="card inbox">
      <div className="row between"><h2 style={{ margin: 0 }}>받은 알림</h2>
        <button className="btn small ghost" onClick={async () => {
          if (!auth.userId) return;
          try { await setMuted(auth.userId, doc.id, !det.muted); toast(det.muted ? '이 약속 알림을 다시 켰어요.' : '이 약속 알림을 껐어요. 화면에서는 계속 볼 수 있어요.'); await onChanged(); }
          catch (e) { toast(e instanceof ApiError ? e.message : '저장하지 못했어요.'); }
        }}>{det.muted ? '🔕 알림 켜기' : '이 약속 알림 끄기'}</button>
      </div>
      {items.length ? items.map((m, i) => <div className="msg" key={i}><small>{m.label} · {stamp(m.at)} · {m.who}</small>{m.text}</div>)
        : <p className="muted" style={{ marginTop: 8 }}>아직 알림이 없어요. 기한 3일 전 오전 9시에 알림이 가요.</p>}
      <div className="row end" style={{ marginTop: 8 }}>
        {!reporting ? <button className="btn small ghost" onClick={() => setReporting(true)}>신고하기</button> : (
          <div style={{ width: '100%' }}>
            <label className="f">신고 사유</label>
            <input className="i" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="예: 모르는 약속인데 계속 재촉이 와요 / 협박성 메시지" />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setReporting(false)}>취소</button>
              <button className="btn seal grow" disabled={!reason.trim()} onClick={async () => {
                try {
                  await action({ action: 'abuse_report', id: doc.id, reason: reason.trim() });
                  if (auth.userId && !det.muted) await setMuted(auth.userId, doc.id, true);
                  toast('신고했어요. 이 약속 알림도 껐어요.');
                  setReporting(false); setReason(''); await onChanged();
                } catch (e) { toast(e instanceof ApiError ? e.message : '신고하지 못했어요.'); }
              }}>신고하고 알림 끄기</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
