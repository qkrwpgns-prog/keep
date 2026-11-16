import { useEffect, useState } from 'react';
import { action, ApiError, deleteAccount } from '../lib/api';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toast';
import { go } from '../lib/router';
import { LoginSheet } from '../components/LoginSheet';

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

  useEffect(() => { setName(auth.profile?.display_name || ''); setEmail(auth.profile?.notify_email || ''); }, [auth.profile]);

  if (!auth.ready) return null;
  if (!auth.userId) {
    return (<>
      <h1>설정</h1>
      <div className="card"><p className="muted">로그인하면 알림 받을 이메일을 정하고, 이전 버전 약속을 가져올 수 있어요.</p><button className="btn block" onClick={() => setLogin(true)}>로그인</button></div>
      {login && <LoginSheet reason="카카오 또는 이메일로 로그인해 주세요." onClose={() => setLogin(false)} />}
    </>);
  }

  const saveProfile = async () => {
    const e = email.trim();
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('이메일 주소를 확인해 주세요.');
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() || null, notify_email: e || null }).eq('id', auth.userId!);
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
        <label className="f">알림 받을 이메일</label>
        <input className="i" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="기한 알림·재촉을 받을 주소" />
        <p className="faint" style={{ marginTop: 4 }}>카카오 로그인에서는 이메일을 받지 않아요. 알림을 받으려면 여기에 적어 주세요. iPhone은 홈 화면에 설치해야 푸시가 와서 이메일을 함께 보내요.</p>
        <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy} onClick={saveProfile}>저장</button>
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
