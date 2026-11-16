import { useEffect, useState } from 'react';
import { STAGES, STATUS, TPL } from '@domain/templates.ts';
import { ddayLabel, diffDays, isYmd, korDate } from '@domain/dates.ts';
import { docToday, promiseStage, subjectText } from '@domain/progress.ts';
import { EXAMPLES } from '@domain/examples.ts';
import { action, ApiError, listMine, type ListItem } from '../lib/api';
import { useDemoMode } from '../lib/demo';
import { useToast } from '../lib/toast';
import { useAuth } from '../lib/auth';
import { go } from '../lib/router';
import { loadDraft } from '../lib/draft';
import { LoginSheet } from '../components/LoginSheet';
import { hasLegacyLocal } from './Settings';

export function Home() {
  const auth = useAuth();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [err, setErr] = useState('');
  const [login, setLogin] = useState(false);
  const demo = useDemoMode();
  const toast = useToast();
  const [making, setMaking] = useState('');
  const draft = loadDraft();
  const hasDraft = draft.step > 1 || draft.raw.trim().length > 4;

  useEffect(() => {
    if (!auth.userId) { setItems(null); return; }
    listMine(auth.userId).then(setItems).catch((e) => setErr(e.message));
  }, [auth.userId]);

  // 시연 데이터는 일반 목록에 보이지 않음(시연 모드를 켜면 따로 보임)
  const all = (items || []).filter((x) => !x.doc.isDemo);
  const demos = (items || []).filter((x) => x.doc.isDemo);
  const makeDemo = async (key: string) => {
    setMaking(key);
    try { const r = await action<{ code: string }>({ action: 'demo_create', example: key }); go('/p/' + r.code); }
    catch (e) { toast(e instanceof ApiError ? e.message : '시연 약속을 만들지 못했어요.'); }
    finally { setMaking(''); }
  };
  const row = ({ doc: p, myRole }: ListItem) => {
    const today = docToday(p);
    const st = STATUS[p.status];
    const late = isYmd(p.deadline) && diffDays(today, p.deadline) > 0 && p.status !== 'done';
    const stage = promiseStage(p, today);
    return (
      <button className="item" key={p.id} onClick={() => go('/p/' + p.code)}>
        <div className="row between"><span className="t">{p.isDemo && <span className="demo-badge" style={{ marginRight: 6 }}>시연</span>}{p.title || TPL[p.tpl].name}</span><span className={'dday ' + (late ? 'late' : '')}>{p.status === 'done' ? '✓' : ddayLabel(today, p.deadline)}</span></div>
        <div className="s">{TPL[p.tpl].name} · {myRole === 'A' ? p.bName : p.aName}님과 · {subjectText(p)} · {korDate(p.deadline)}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <span className={'pill ' + st.c}>{st.t}</span>
          {stage > 0 && <span className="pill seal">{STAGES[stage - 1].name} 단계</span>}
          {myRole === 'B' && !p.isDemo && <span className="pill">내가 지킬 약속</span>}
        </div>
      </button>
    );
  };
  const cnt = (s: string[]) => all.filter((x) => s.includes(x.doc.status)).length;

  return (
    <>
      <section className="hero">
        <div className="tag">친한 사이일수록,<br /><span>약속은 기록</span>으로.</div>
        <p className="muted" style={{ marginTop: 8 }}>카톡 대화를 붙여넣으면 약속증서를 만들고, 기한이 지나면 단계적으로 재촉해 줘요. 증서는 서버에 안전하게 보관돼 카톡 안에서 열어도, 휴대폰을 바꿔도 그대로 보여요.</p>
      </section>
      {auth.userId && (
        <div className="stats">
          <div className="stat"><b>{cnt(['active', 'reported'])}</b><span>진행 중</span></div>
          <div className="stat"><b>{cnt(['pending_b', 'revise'])}</b><span>서명 대기</span></div>
          <div className="stat"><b>{cnt(['done'])}</b><span>지킴 완료</span></div>
        </div>
      )}
      <button className="btn seal block" onClick={() => go('/new')}>{hasDraft ? '쓰던 약속 이어서 쓰기' : '＋ 새 약속 만들기'}</button>
      {!auth.ready ? null : !auth.userId ? (
        <div className="card flat" style={{ marginTop: 14 }}>
          <h3>로그인하면 내 약속이 보여요</h3>
          <p className="muted">로그인 없이도 증서 초안까지 쓸 수 있어요. 서명할 때 로그인하면 어느 브라우저에서나 같은 약속을 볼 수 있어요.</p>
          <button className="btn block" onClick={() => setLogin(true)}>로그인</button>
        </div>
      ) : (
        <div className="list" style={{ marginTop: 8 }}>
          {hasLegacyLocal() && <div className="card blue flat"><b>이 기기에 이전 버전 약속이 있어요</b><p className="muted">설정에서 계정으로 가져올 수 있어요.</p><button className="btn small" onClick={() => go('/settings')}>가져오기</button></div>}
          {err && <div className="card warn flat">{err}</div>}
          {items === null && <div className="empty"><span className="spin" /></div>}
          {items && all.length === 0 && <div className="empty"><div className="sealmark" style={{ margin: '0 auto 12px', width: 46, height: 46, fontSize: 24 }}>約</div>아직 기록한 약속이 없어요.<br />친구와의 약속 하나를 증서로 남겨 보세요.</div>}
          {all.map(row)}
        </div>
      )}
      {demo && auth.userId && (
        <div className="card warn" style={{ marginTop: 14 }}>
          <h3><span className="demo-badge">시연</span> 시연 약속</h3>
          <p className="muted">예시 대화로 진행 중인 약속을 바로 만들어요. 혼자 A·B 화면을 바꿔 가며 날짜를 되감고 알림을 보내 볼 수 있어요. 일반 목록에는 나오지 않아요.</p>
          <div className="chips">{EXAMPLES.map((e) => <button key={e.key} className="chip" disabled={!!making} onClick={() => makeDemo(e.key)}>{making === e.key ? '만드는 중…' : e.label}</button>)}</div>
          <div className="list">{demos.map(row)}</div>
        </div>
      )}
      <div className="card flat">
        <h3>이렇게 써요</h3>
        <ol className="howto">
          <li><b>대화를 붙여넣고 서명</b>하면 짧은 링크와 QR이 생겨요. 카톡으로 보내거나 QR을 보여주세요.</li>
          <li><b>상대가 링크를 열어 동의·로그인 후 서명</b>하면 증서가 확정돼요. 내 화면도 자동으로 바뀌어요.</li>
          <li>이후 <b>연장·분할 요청, 이행 신고와 확인</b>이 모두 같은 약속 화면에 기록돼요.</li>
        </ol>
      </div>
      {login && <LoginSheet reason="이메일로 받은 인증 코드로 로그인해 주세요." onClose={() => setLogin(false)} />}
    </>
  );
}
