import { useEffect, useMemo, useState } from 'react';
import { TPL, TEMPLATE_KEYS, EXAMPLE_CHAT, type TemplateKey } from '@domain/templates.ts';
import { ruleCheck, ruleExtract } from '@domain/rules.ts';
import { hangulAmount } from '@domain/korean.ts';
import { isYmd, kstToday } from '@domain/dates.ts';
import { strokesToVector } from '@domain/signature.ts';
import { checkRates, parseRate, MAX_INTEREST_RATE } from '@domain/guardrails.ts';
import type { CertDoc } from '@domain/certificate.ts';
import { Certificate } from '../components/Certificate';
import { SignaturePad } from '../components/SignaturePad';
import { LoginSheet } from '../components/LoginSheet';
import { clearDraft, loadDraft, newDraft, saveDraft, type Draft } from '../lib/draft';
import { action, ApiError, loadDetail } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';

const num = (s: string) => Number(String(s).replace(/[^\d]/g, '')) || 0;

export function NewPromise({ editCode }: { editCode?: string }) {
  const auth = useAuth();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() => loadDraft());
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const up = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const upF = (k: keyof Draft['f'], v: string) => setD((x) => ({ ...x, f: { ...x.f, [k]: v } }));

  useEffect(() => { saveDraft(d); }, [d]);

  // 수정 모드: 서버의 최신 내용으로 채움
  useEffect(() => {
    if (!editCode || !auth.userId) return;
    if (d.editId && d.step > 1 && d.f.title) return; // 이미 편집 중(로그인 복귀 등)
    loadDetail(editCode, auth.userId).then((det) => {
      if (!det || det.myRole !== 'A') { toast('수정할 수 없는 약속이에요.'); go('/'); return; }
      const p = det.doc;
      setD({
        ...newDraft(), step: 2, tpl: p.tpl, inputMode: 'manual', myName: p.aName, editId: p.id, editVersion: p.version,
        f: { title: p.title, aName: p.aName, bName: p.bName, amount: p.amount ? String(p.amount) : '', interestRate: p.interestRate != null ? String(p.interestRate) : '', lateInterestRate: p.lateInterestRate != null ? String(p.lateInterestRate) : '', repayAccount: p.repayAccount, item: p.item, task: p.task, deadline: p.deadline, method: p.method, penalty: p.penalty, memo: p.memo },
        questions: det.reviseNote ? ['상대의 요청: ' + det.reviseNote] : [],
      });
    }).catch(() => toast('약속을 불러오지 못했어요.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCode, auth.userId]);

  const T = TPL[d.tpl];
  const kind = T.kind;
  const rateCheck = useMemo(() => checkRates({ amount: num(d.f.amount) || null, interestRate: d.tpl === 'loan' ? parseRate(d.f.interestRate) : null, lateInterestRate: d.tpl === 'loan' ? parseRate(d.f.lateInterestRate) : null }), [d.f.amount, d.f.interestRate, d.f.lateInterestRate, d.tpl]);

  const certDoc: CertDoc = {
    code: '(서명 후 발급)', tpl: d.tpl, title: d.f.title, aName: d.f.aName, bName: d.f.bName,
    amount: kind === 'money' ? num(d.f.amount) || null : null,
    interestRate: d.tpl === 'loan' ? parseRate(d.f.interestRate) : null,
    lateInterestRate: d.tpl === 'loan' ? parseRate(d.f.lateInterestRate) : null,
    repayAccount: kind === 'money' ? d.f.repayAccount : '', item: kind === 'item' ? d.f.item : '', task: kind === 'task' ? d.f.task : '',
    deadline: d.f.deadline, method: d.f.method, penalty: d.f.penalty, memo: d.f.memo, installments: [], amendments: [], sigA: null, sigB: null, createdAt: new Date().toISOString(),
  };

  const bar = <div className="steps">{[1, 2, 3].map((i) => <div key={i} className={i <= d.step ? 'on' : ''} />)}</div>;

  const extract = () => {
    const f = { ...d.f };
    let quote = '';
    if (d.inputMode === 'text') {
      const r = ruleExtract({ raw: d.raw, tpl: d.tpl, myName: d.myName }, kstToday());
      f.title = r.title || f.title; f.aName = d.myName || r.aName || f.aName; f.bName = r.bName || f.bName;
      f.amount = r.amount ? String(r.amount) : f.amount; f.item = r.item || f.item; f.task = r.task || f.task;
      f.deadline = r.deadline || f.deadline; f.method = r.method || f.method; f.penalty = r.penalty || f.penalty; quote = r.quote;
    } else f.aName ||= d.myName;
    up({ f, quote, questions: ruleCheck(f, d.tpl), step: 2 });
    window.scrollTo(0, 0);
  };

  const to3 = () => {
    const f = d.f, miss: string[] = [];
    if (!f.aName.trim()) miss.push('내 이름');
    if (!f.bName.trim()) miss.push('상대 이름');
    if (!isYmd(f.deadline)) miss.push('기한');
    if (kind === 'money' && !(num(f.amount) > 0)) miss.push('금액');
    if (kind === 'item' && !f.item.trim()) miss.push('물건');
    if (kind === 'task' && !f.task.trim()) miss.push('약속 내용');
    if (miss.length) return toast(miss.join(', ') + '을(를) 채워 주세요.');
    if (!rateCheck.ok) return toast(rateCheck.error!);
    up({ step: 3 });
    window.scrollTo(0, 0);
  };

  const sign = async () => {
    const sv = strokesToVector(d.strokes);
    if (!sv) return toast('서명을 해 주세요.');
    if (!d.agree) return toast('내용 확인에 체크해 주세요.');
    if (!auth.userId) { setLogin(true); return; }
    setBusy(true);
    try {
      const body = { tpl: d.tpl, fields: { ...d.f, aName: d.f.aName.trim(), bName: d.f.bName.trim() }, signature: sv, agree: true, quote: d.quote };
      let code: string;
      if (d.editId) {
        await action({ action: 'update', id: d.editId, version: d.editVersion, ...body });
        code = editCode!;
      } else {
        const r = await action<{ code: string; notice?: string }>({ action: 'create', ...body });
        code = r.code;
        if (r.notice) setTimeout(() => toast(r.notice!, 9000), 600);
      }
      clearDraft();
      toast('서명 완료! QR이나 링크를 상대에게 보내 주세요.');
      go('/p/' + code);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '서명하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (d.step === 1) {
    const can = d.inputMode === 'manual' || d.raw.trim().length > 4;
    return (
      <>
        {bar}
        <div className="row between"><h1>어떤 약속인가요?</h1>{(d.raw || d.myName) && <button className="btn small ghost" onClick={() => setD(newDraft())}>처음부터</button>}</div>
        <div className="tpls">
          {TEMPLATE_KEYS.map((k) => <button key={k} className={'tpl ' + (d.tpl === k ? 'on' : '')} onClick={() => up({ tpl: k })}><b>{TPL[k].name}</b><span>{TPL[k].desc}</span></button>)}
        </div>
        <label className="f">내 이름 (작성자)</label>
        <input className="i" value={d.myName} onChange={(e) => up({ myName: e.target.value })} placeholder="실명을 적으면 증서에 그대로 들어가요" />
        <label className="f">입력 방식</label>
        <div className="seg">
          {([['text', '대화 붙여넣기'], ['manual', '직접 입력']] as const).map(([k, l]) => <button key={k} className={d.inputMode === k ? 'on' : ''} onClick={() => up({ inputMode: k })}>{l}</button>)}
        </div>
        {d.inputMode === 'text' ? (
          <>
            <label className="f">약속이 담긴 대화나 메모<em>*</em></label>
            <textarea className="i" value={d.raw} onChange={(e) => up({ raw: e.target.value })} placeholder={'카톡 대화를 그대로 붙여넣거나, 키보드의 🎤 버튼으로 말해 보세요.\n예) 민수: 다음 달 15일에 30만원 계좌로 보낼게!'} />
            <div className="row between" style={{ marginTop: 6 }}>
              <span className="faint">금액·날짜·이름·방법을 찾아 빈칸을 채워요.</span>
              <button className="btn small ghost" onClick={() => up({ raw: EXAMPLE_CHAT, myName: d.myName || '제훈', tpl: 'loan' })}>예시 넣기</button>
            </div>
          </>
        ) : <p className="muted" style={{ marginTop: 12 }}>다음 단계에서 항목을 하나씩 직접 채워요.</p>}
        <div style={{ marginTop: 18 }}><button className="btn primary block" disabled={!can} onClick={extract}>{d.inputMode === 'manual' ? '다음' : '증서 초안 만들기'}</button></div>
        <p className="faint" style={{ marginTop: 10 }}>로그인 없이 초안까지 쓸 수 있어요. 서명할 때 로그인해요.</p>
      </>
    );
  }

  if (d.step === 2) {
    const f = d.f;
    return (
      <>
        {bar}
        <h1>{d.editId ? '내용을 고쳐 주세요' : '내용을 확인해 주세요'}</h1>
        <p className="muted">{d.inputMode === 'text' && !d.editId ? '대화에서 찾은 내용이에요. 틀린 곳은 바로 고쳐 주세요.' : '빈칸을 채워 주세요.'}</p>
        {d.quote && <div className="quote">{d.quote}</div>}
        {d.questions.length > 0 && <div className="card warn flat"><b>확인이 필요해요</b><div className="qs">{d.questions.map((q) => <div className="q" key={q}>{q}</div>)}</div></div>}
        <div className="card">
          <div className="seg" style={{ marginBottom: 6 }}>
            {TEMPLATE_KEYS.map((k) => <button key={k} className={d.tpl === k ? 'on' : ''} style={{ fontSize: 12 }} onClick={() => up({ tpl: k as TemplateKey })}>{TPL[k].name.replace(/ .*/, '')}</button>)}
          </div>
          <label className="f">제목</label>
          <input className="i" value={f.title} onChange={(e) => upF('title', e.target.value)} placeholder="예: 민수 월세 30만원" maxLength={80} />
          <div className="two">
            <div><label className="f">{T.a} (나)<em>*</em></label><input className="i" value={f.aName} onChange={(e) => upF('aName', e.target.value)} maxLength={40} /></div>
            <div><label className="f">{T.b} (상대)<em>*</em></label><input className="i" value={f.bName} onChange={(e) => upF('bName', e.target.value)} maxLength={40} /></div>
          </div>
          {kind === 'money' && (
            <>
              <label className="f">{T.what} (원)<em>*</em></label>
              <input className="i" inputMode="numeric" value={f.amount} onChange={(e) => upF('amount', e.target.value.replace(/[^\d]/g, ''))} placeholder="300000" />
              {num(f.amount) > 0 && <div className="faint" style={{ marginTop: 4 }}>금 {hangulAmount(num(f.amount))}원정</div>}
            </>
          )}
          {kind === 'item' && (<><label className="f">{T.what}<em>*</em></label><input className="i" value={f.item} onChange={(e) => upF('item', e.target.value)} placeholder="예: 닌텐도 스위치 OLED (케이스 포함)" maxLength={200} /></>)}
          {kind === 'task' && (<><label className="f">{T.what}<em>*</em></label><textarea className="i" style={{ minHeight: 80 }} value={f.task} onChange={(e) => upF('task', e.target.value)} placeholder="예: 발표 자료 5~8장 작성 후 공유" maxLength={500} /></>)}
          {d.tpl === 'loan' && (
            <>
              <div className="two">
                <div><label className="f">이자 (연 %, 선택)</label><input className="i" inputMode="decimal" value={f.interestRate} onChange={(e) => upF('interestRate', e.target.value.replace(/[^\d.]/g, ''))} placeholder="없음" /></div>
                <div><label className="f">연체이자 (연 %, 선택)</label><input className="i" inputMode="decimal" value={f.lateInterestRate} onChange={(e) => upF('lateInterestRate', e.target.value.replace(/[^\d.]/g, ''))} placeholder="없음" /></div>
              </div>
              {!rateCheck.ok ? <div className="err">{rateCheck.error}</div> : rateCheck.notice ? <div className="notice">{rateCheck.notice}</div> : <div className="faint" style={{ marginTop: 4 }}>이자·연체이자는 이자제한법에 따라 연 {MAX_INTEREST_RATE}%까지만 적을 수 있어요.</div>}
            </>
          )}
          <div className="two">
            <div><label className="f">{T.due}<em>*</em></label><input className="i" type="date" value={f.deadline} onChange={(e) => upF('deadline', e.target.value)} /></div>
            <div><label className="f">{T.how}</label><input className="i" value={f.method} onChange={(e) => upF('method', e.target.value)} placeholder="계좌이체" maxLength={100} /></div>
          </div>
          {kind === 'money' && (<><label className="f">받을 계좌 (선택)</label><input className="i" value={f.repayAccount} onChange={(e) => upF('repayAccount', e.target.value)} placeholder="예: 국민 123-456-789012" maxLength={80} /><div className="faint" style={{ marginTop: 4 }}>증서와 화면에는 가운데 숫자를 가려서 보여줘요.</div></>)}
          <label className="f">어겼을 때 (선택)</label>
          <input className="i" value={f.penalty} onChange={(e) => upF('penalty', e.target.value)} placeholder="예: 늦으면 밥 한 번 사기" maxLength={200} />
          <label className="f">특약·메모 (선택)</label>
          <input className="i" value={f.memo} onChange={(e) => upF('memo', e.target.value)} maxLength={500} />
        </div>
        <div className="row">
          {!d.editId && <button className="btn" onClick={() => up({ step: 1 })}>이전</button>}
          <button className="btn" onClick={() => { const q = ruleCheck(d.f, d.tpl); up({ questions: q }); if (!q.length) toast('빠진 곳이 없어요 👍'); }}>빈칸 점검</button>
          <button className="btn primary grow" onClick={to3}>서명하러 가기</button>
        </div>
      </>
    );
  }

  return (
    <>
      {bar}
      <h1>확인하고 서명해요</h1>
      <p className="muted">서명하면 상대에게 보낼 QR·링크가 생겨요. 상대도 확인·서명해야 증서가 확정돼요.</p>
      <Certificate doc={certDoc} revealAccount />
      <div className="card">
        <h3>작성자 서명 · {d.f.aName}</h3>
        <label className="f">손글씨 서명</label>
        <SignaturePad value={d.strokes} onChange={(s) => up({ strokes: s })} />
        <label className="check"><input type="checkbox" checked={d.agree} onChange={(e) => up({ agree: e.target.checked })} /> 위 내용을 확인했고, 본인이 직접 서명합니다.</label>
        <p className="faint" style={{ marginTop: 8 }}>서명할 때 로그인한 계정, 서명 시각, 접속 IP·기기 정보가 증거로 함께 기록돼요.</p>
        {!auth.userId && <div className="notice">서명하려면 로그인이 필요해요. 쓰던 내용과 서명은 그대로 남아요.</div>}
      </div>
      <div className="row">
        <button className="btn" onClick={() => up({ step: 2 })}>이전</button>
        <button className="btn seal grow" disabled={busy} onClick={sign}>{busy ? <span className="spin" /> : auth.userId ? (d.editId ? '다시 서명하고 보내기' : '서명하고 QR 만들기') : '로그인하고 서명하기'}</button>
      </div>
      {login && <LoginSheet reason="서명은 본인 확인을 위해 로그인한 뒤에 할 수 있어요. 로그인하고 돌아오면 '서명하고 QR 만들기'를 한 번 더 눌러 주세요." onClose={() => setLogin(false)} />}
    </>
  );
}
