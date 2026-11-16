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
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: sub.endpoint, user_id: userId, keys: j.keys }, { onConflict: 'endpoint' });
  if (error) throw new Error('알림 구독을 저장하지 못했어요.');
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
