import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { RETURN_URL, supabase } from './supabase';
import { relinkPush, unlinkPush } from './push';

export interface Profile { id: string; display_name: string | null; notify_email: string | null; notify_push: boolean; notify_email_on: boolean }

interface AuthState {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  profileError: boolean;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);
const RETURN_KEY = 'keep.returnTo';

/** 메일의 링크로 들어와도 원래 화면(해시)으로 돌아오게 */
function rememberRoute() {
  try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/'); } catch { /* 저장 불가 */ }
}
function restoreRoute() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  let back = '#/';
  try { back = sessionStorage.getItem(RETURN_KEY) || '#/'; sessionStorage.removeItem(RETURN_KEY); } catch { /* 무시 */ }
  history.replaceState(null, '', location.pathname + back);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);

  // 프로필은 서버 함수로 읽는다: 행이 없으면 만들고, 알림 이메일이 비면 로그인 이메일로 채운다
  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) { setProfile(null); return; }
    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase.rpc('keep_profile_ensure');
      if (!error && data) { setProfile(data as Profile); setProfileError(false); return; }
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
    setProfileError(true);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setReady(true);
      restoreRoute();
      void loadProfile(data.session?.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, s) => {
      setSession(s);
      // supabase-js 권장: 이 콜백 안에서 바로 supabase를 호출하면 인증 잠금과 엉킬 수 있어 다음 틱으로 미룬다
      setTimeout(() => {
        if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') void loadProfile(s?.user.id);
        if (ev === 'SIGNED_IN') { restoreRoute(); void relinkPush().catch(() => {}); }
      }, 0);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value: AuthState = {
    ready, session, userId: session?.user.id ?? null, profile, profileError,
    async sendOtp(email) {
      rememberRoute();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: RETURN_URL } });
      if (error) throw new Error(/rate|seconds/i.test(error.message) ? '잠시 후 다시 요청해 주세요.' : '인증 메일을 보내지 못했어요. 주소를 확인해 주세요.');
    },
    async verifyOtp(email, token) {
      const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw new Error('코드가 맞지 않거나 만료됐어요.');
    },
    async signOut() { await unlinkPush().catch(() => {}); await supabase.auth.signOut(); },
    reloadProfile: () => loadProfile(session?.user.id),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
