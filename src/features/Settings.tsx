import { useEffect, useState } from 'react';
import { action, ApiError, deleteAccount } from '../lib/api';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';
import { LoginSheet } from '../components/LoginSheet';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../lib/push';
import { setDemoMode, useDemoMode } from '../lib/demo';

const LEGACY_KEY = 'keep.web.v1';
export function hasLegacyLocal(): boolean {
  try { const a = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); return Array.isArray(a) && a.length > 0; } catch { return false; }
}

export function Settings() {
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const [importLog, setImportLog] = useState<string[]>([]);
  const [confirm, setConfirm] = useState('');

  const [emailOn, setEmailOn] = useState(true);
  const [pushOn, setPushOn] = useState(false);
  // 프로필을 처음 받았을 때만 입력칸을 채운다(새로고침마다 쓰던 값을 덮지 않게)
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!auth.profile || filled) return;
    setName(auth.profile.display_name || ''); setEmail(auth.profile.notify_email || ''); setEmailOn(auth.profile.notify_email_on ?? true); setFilled(true);
  }, [auth.profile, filled]);
  useEffect(() => { currentSubscription().then((s) => setPushOn(!!s)).catch(() => {}); }, []);
  const support = pushSupport();
  const demo = useDemoMode();

  if (!auth.ready) return null;
  if (!auth.userId) {
    return (<>
      <h1>설정</h1>
      <div className="card"><p className="muted">로그인하면 알림 받을 이메일을 정하고, 이전 버전 약속을 가져올 수 있어요.</p><button className="btn block" onClick={() => setLogin(true)}>로그인</button></div>
      {login && <LoginSheet reason="이메일로 받은 인증 코드로 로그인해 주세요." onClose={() => setLogin(false)} />}
    </>);
  }

  const saveProfile = async () => {
    if (!filled) return toast('내 정보를 아직 불러오는 중이에요. 잠시 후 다시 눌러 주세요.');
    const e = email.trim();
    if (emailOn && !e) return toast('이메일 알림을 받으려면 이메일 주소를 적어 주세요.');
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('이메일 주소를 확인해 주세요.');
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() || null, notify_email: e || null, notify_email_on: emailOn }).eq('id', auth.userId!);
    setBusy(false);
    if (error) return toast('저장하지 못했어요.');
    await auth.reloadProfile();
    toast('저장했어요.');
  };

  const importList = async (list: unknown[]) => {
    const log: string[] = [];
    for (const p of list) {
      const t = (p as { title?: string }).title || '약속';
      try {
        const r = await action<{ verified: boolean }>({ action: 'import', legacy: p });
        log.push(`✓ ${t}${r.verified ? ' (확인코드 일치)' : ''}`);
      } catch (e) {
        log.push(`✕ ${t}: ${e instanceof ApiError ? e.message : '가져오지 못함'}`);
      }
    }
    setImportLog(log);
  };

  return (
    <>
      <h1>설정</h1>
      <div className="card">
        <h2>내 정보</h2>
        <label className="f">이름 (증서 작성 시 기본값)</label>
        <input className="i" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <label className="check"><input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} /> 이메일로 알림 받기 (기한 알림·재촉·상대의 서명·요청)</label>
        <label className="f">알림 받을 이메일</label>
        <input className="i" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="기한 알림·재촉을 받을 주소" />
        <p className="faint" style={{ marginTop: 4 }}>처음에는 로그인한 이메일로 정해져요. 다른 주소로 받고 싶으면 바꿔 주세요. iPhone은 홈 화면에 설치해야 푸시가 와서 이메일을 함께 보내요.</p>
        {auth.profileError && <div className="err">내 정보를 불러오지 못했어요. 새로고침해 주세요.</div>}
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || !filled} onClick={saveProfile}>{filled ? '저장' : '불러오는 중…'}</button>
      </div>

      <div className="card">
        <h2>이 기기 앱 알림</h2>
        <p className="muted">밤 9시부터 아침 9시 사이에는 보내지 않고, 아침 9시에 모아서 보내요. 약속별로 끄려면 약속 화면의 '이 약속 알림 끄기'를 누르세요.</p>
        {support === 'ok' ? (
          pushOn
            ? <button className="btn block" onClick={async () => { await disablePush(); setPushOn(false); toast('이 기기 앱 알림을 껐어요.'); }}>이 기기 알림 끄기</button>
            : <button className="btn primary block" onClick={async () => { try { await enablePush(auth.userId!); setPushOn(true); toast('이 기기에서 앱 알림을 받아요.'); } catch (e) { toast((e as Error).message); } }}>이 기기 알림 켜기</button>
        ) : (
          <div className="notice">
            {support === 'kakao' && '카카오톡 안에서는 앱 알림을 받을 수 없어요. 오른쪽 위 ⋮ → 다른 브라우저로 열기를 누른 뒤, 홈 화면에 추가해 주세요. 그 전까지는 이메일로 알려 드려요.'}
            {support === 'ios-install' && <>iPhone은 키프를 홈 화면에 설치해야 앱 알림을 받을 수 있어요. 사파리 아래쪽 <b>공유 버튼 → 홈 화면에 추가</b>를 누른 뒤, 홈 화면의 키프 아이콘으로 열어 여기서 알림을 켜 주세요. 그 전까지는 이메일로 알려 드려요.</>}
            {support === 'denied' && '이 브라우저에서 알림이 차단돼 있어요. 브라우저 설정 → 사이트 설정 → 알림에서 허용해 주세요.'}
            {support === 'unsupported' && '이 브라우저는 앱 알림을 지원하지 않아요. 이메일로 알려 드려요.'}
            {support === 'no-key' && '앱 알림 설정이 아직 준비되지 않았어요. 이메일로 알려 드려요.'}
          </div>
        )}
      </div>

      <div className="card">
        <h2>이전 버전 약속 가져오기</h2>
        <p className="muted">예전 키프(이 기기에만 저장되던 버전)에서 '백업 저장'으로 받은 파일을 올려 주세요. 주소가 바뀌어서 예전 브라우저 저장소는 자동으로 옮겨지지 않아요.</p>
        <label className="btn block">백업 파일 선택<input type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (data.app !== 'keep' || !Array.isArray(data.promises)) throw new Error();
            await importList(data.promises);
          } catch { toast('키프 백업 파일이 아니에요.'); }
        }} /></label>
        {hasLegacyLocal() && <button className="btn block" style={{ marginTop: 8 }} onClick={() => { try { void importList(JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]')); } catch { toast('불러오지 못했어요.'); } }}>이 브라우저에 남은 약속 가져오기</button>}
        {importLog.length > 0 && <div className="quote" style={{ marginTop: 10 }}>{importLog.join('\n')}</div>}
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>시연 모드</h2>
          <button className={'btn small ' + (demo ? 'primary' : '')} onClick={() => { setDemoMode(!demo); toast(demo ? '시연 모드를 껐어요.' : '시연 모드를 켰어요. 홈에서 시연 약속을 만들어 보세요.'); }}>{demo ? '켜짐 · 끄기' : '켜기'}</button></div>
        <p className="muted" style={{ marginTop: 8 }}>발표·시연용이에요. 켜면 홈에 '시연 약속' 칸이 생기고, 시연 약속 화면에서 시간 되감기(실제/D-3/D-day/D+3/D+7/D+14), A/B 화면 전환, 오전 9시 점검 즉시 실행을 쓸 수 있어요. 시연 데이터에는 '시연' 표시가 붙고 일반 목록에는 나오지 않아요.</p>
      </div>

      <div className="card flat">
        <div className="row between"><span className="muted">로그아웃</span><button className="btn small" onClick={async () => { await auth.signOut(); go('/'); }}>로그아웃</button></div>
      </div>

      <details className="card flat">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>탈퇴</summary>
        <div className="consent" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>· 상대 서명이 끝나지 않은 약속(작성 중·서명 대기·취소·거절)은 바로 지워져요.<br />
            · 양쪽이 서명한 증서는 <b>상대방의 증거로 남아요</b>. 대신 내 계정 연결·알림 이메일·푸시 구독을 지우고, 접속 IP와 기기 정보를 줄여서 보관해요(이름·서명·서명 시각·확인코드는 증서에 남아요).<br />
            · 남은 증서는 완료 후 1년, 미완료면 기한 후 10년이 지나면 파기해요.</p>
        </div>
        <label className="f">확인을 위해 '탈퇴'라고 입력해 주세요</label>
        <input className="i" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className="btn seal block" style={{ marginTop: 8 }} disabled={confirm !== '탈퇴' || busy} onClick={async () => {
          setBusy(true);
          try { await deleteAccount(); await auth.signOut(); toast('탈퇴했어요. 그동안 고마웠어요.'); go('/'); }
          catch (e) { toast(e instanceof ApiError ? e.message : '탈퇴하지 못했어요.'); }
          finally { setBusy(false); }
        }}>탈퇴하기</button>
      </details>
    </>
  );
}
