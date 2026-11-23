import { useEffect, useState } from 'react';

/** 인터넷이 끊기면 화면 위에 안내. 다시 연결되면 잠깐 '다시 연결됐어요'를 보여 준다 */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [back, setBack] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => { setOnline(true); setBack(true); clearTimeout(t); t = setTimeout(() => setBack(false), 3000); };
    const off = () => { setOnline(false); setBack(false); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearTimeout(t); };
  }, []);
  if (online && !back) return null;
  return (
    <div className={'offline' + (online ? ' back' : '')} role="status" aria-live="polite">
      {online ? '다시 연결됐어요.' : '인터넷 연결이 끊겼어요. 증서·목록은 마지막으로 본 내용이에요. 쓰던 내용은 이 기기에 남아 있으니, 연결되면 이어서 서명·전송할 수 있어요.'}
    </div>
  );
}
