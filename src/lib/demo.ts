// 시연 모드 켜기/끄기 (이 기기에만 저장)
import { useEffect, useState } from 'react';

const KEY = 'keep.demo';
const EVT = 'keep-demo-change';
export const isDemoMode = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export function setDemoMode(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 저장 불가 */ }
  window.dispatchEvent(new Event(EVT));
}
export function useDemoMode(): boolean {
  const [on, setOn] = useState(isDemoMode);
  useEffect(() => {
    const f = () => setOn(isDemoMode());
    window.addEventListener(EVT, f);
    window.addEventListener('storage', f);
    return () => { window.removeEventListener(EVT, f); window.removeEventListener('storage', f); };
  }, []);
  return on;
}
