import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { isKakaoInApp } from '../lib/share';

export function LoginSheet({ reason, onClose }: { reason: string; onClose: () => void }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <h2 id="login-title">로그인</h2>
        <p className="muted">{reason}</p>
        <button className="btn kakao block" disabled={busy} onClick={() => run(auth.signInKakao)}>카카오로 계속하기</button>
        {isKakaoInApp() && <p className="faint" style={{ marginTop: 6 }}>카카오톡 안에서도 바로 로그인돼요.</p>}
        <div className="faint" style={{ textAlign: 'center', margin: '14px 0 4px' }}>또는 이메일로 받은 6자리 코드</div>
        {!sent ? (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.sendOtp(email.trim()); setSent(true); }); }}>
            <input className="i" type="email" inputMode="email" autoComplete="email" required placeholder="이메일 주소" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn block" style={{ marginTop: 8 }} disabled={busy || !email.includes('@')}>{busy ? <span className="spin" /> : '인증 코드 받기'}</button>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await auth.verifyOtp(email.trim(), code.trim()); onClose(); }); }}>
            <p className="faint">{email}로 보낸 6자리 코드를 입력해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.</p>
            <input className="i otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => { setSent(false); setCode(''); }}>다시 받기</button>
              <button className="btn primary grow" disabled={busy || code.length !== 6}>{busy ? <span className="spin" /> : '확인'}</button>
            </div>
          </form>
        )}
        {err && <div className="err">{err}</div>}
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
