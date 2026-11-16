import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string, ms?: number) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const t = useRef<number>();
  const toast = useCallback((m: string, ms = 3200) => {
    setMsg(m); setShow(true);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setShow(false), ms);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={'toast' + (show ? ' show' : '')} role="status" aria-live="polite">{msg}</div>
    </Ctx.Provider>
  );
}
