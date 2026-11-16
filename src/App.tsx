import { useRoute, go } from './lib/router';
import { useAuth } from './lib/auth';
import { Home } from './features/Home';
import { NewPromise } from './features/NewPromise';
import { Detail } from './features/Detail';
import { Verify } from './features/Verify';
import { Settings } from './features/Settings';
import { DISCLAIMER } from '@domain/templates.ts';

export function App() {
  const route = useRoute();
  const auth = useAuth();
  const nav = route.name === 'home' ? 'home' : route.name === 'new' ? 'new' : route.name === 'verify' ? 'verify' : route.name === 'settings' ? 'settings' : '';
  return (
    <>
      <div className="app">
        <header className="top">
          <button className="logo" onClick={() => go('/')}><span className="sealmark">約</span><span>키프 Keep<small>말로 한 약속을, 지킬 수밖에 없는 기록으로</small></span></button>
          <div className="top-actions">
            <span className="mode" title={auth.userId ? '약속은 서버에 저장돼 어느 기기에서나 보여요.' : '로그인 전에는 작성 중인 초안만 이 기기에 저장돼요.'}><i style={auth.userId ? undefined : { background: 'var(--ink3)' }} />{auth.userId ? '클라우드 보관' : '로그인 전'}</span>
            <button className="icon-btn" aria-label="설정" onClick={() => go('/settings')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
            </button>
          </div>
        </header>
        <main>
          {route.name === 'home' && <Home />}
          {route.name === 'new' && <NewPromise />}
          {route.name === 'edit' && <NewPromise editCode={route.id} key={route.id} />}
          {route.name === 'promise' && <Detail code={route.code} key={route.code} />}
          {route.name === 'verify' && <Verify />}
          {route.name === 'settings' && <Settings />}
        </main>
        <p className="disc">{DISCLAIMER}</p>
      </div>
      <nav className="bottom"><div className="in">
        <button className={nav === 'home' ? 'on' : ''} onClick={() => go('/')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>내 약속</button>
        <button className={'plus ' + (nav === 'new' ? 'on' : '')} onClick={() => go('/new')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>새 약속</button>
        <button className={nav === 'verify' ? 'on' : ''} onClick={() => go('/verify')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" /><path d="m9 12 2 2 4-4" /></svg>위변조 확인</button>
        <button className={nav === 'settings' ? 'on' : ''} onClick={() => go('/settings')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>설정</button>
      </div></nav>
    </>
  );
}
