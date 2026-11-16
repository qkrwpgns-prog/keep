// Web Push 구독 (iOS는 홈 화면에 설치한 앱에서만 가능)
import { supabase } from './supabase';
import { isIOS, isKakaoInApp } from './share';

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type PushSupport = 'ok' | 'no-key' | 'kakao' | 'ios-install' | 'unsupported' | 'denied';
export function pushSupport(): PushSupport {
  if (!VAPID) return 'no-key';
  if (isKakaoInApp()) return 'kakao';
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** 이 기기 푸시 켜기: 권한 요청 → 구독 → 서버 저장 */
export async function enablePush(userId: string): Promise<void> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 브라우저 설정에서 허용해 주세요.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
  void userId;
  const { error } = await supabase.rpc('keep_push_subscribe', { p_endpoint: sub.endpoint, p_keys: sub.toJSON().keys });
  if (error) throw new Error('알림 구독을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

/** 로그인할 때: 이 기기에 이미 허용된 구독이 있으면 지금 계정으로 다시 연결 */
export async function relinkPush(): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (sub) await supabase.rpc('keep_push_subscribe', { p_endpoint: sub.endpoint, p_keys: sub.toJSON().keys });
}

/** 로그아웃할 때: 이 기기로 이 계정 알림이 오지 않게 서버 연결만 끊음(브라우저 권한은 유지) */
export async function unlinkPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub) await supabase.rpc('keep_push_unsubscribe', { p_endpoint: sub.endpoint });
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.rpc('keep_push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}
