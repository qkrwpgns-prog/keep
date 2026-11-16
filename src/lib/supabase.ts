import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
/** 공유 링크·QR·OAuth 복귀 주소의 기준 (끝에 / 포함) */
export const BASE_URL = (import.meta.env.VITE_PUBLIC_BASE_URL || location.origin + import.meta.env.BASE_URL).replace(/\/?$/, '/');
/** 개발 중에는 현재 주소로 돌아오게 */
export const RETURN_URL = location.origin + import.meta.env.BASE_URL;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true, storageKey: 'keep.auth' },
});

export const shareUrl = (code: string) => `${BASE_URL}#/p/${code}`;
