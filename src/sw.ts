/// <reference lib="webworker" />
// 서비스 워커: 앱 셸 오프라인 캐시 + 푸시 알림
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting(); });

self.addEventListener('push', (e) => {
  let d: { title?: string; body?: string; url?: string; tag?: string } = {};
  try { d = e.data?.json() ?? {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '키프', {
    body: d.body || '',
    tag: d.tag,
    data: { url: d.url || self.registration.scope },
    icon: self.registration.scope + 'icons/icon-192.png',
    badge: self.registration.scope + 'icons/icon-192.png',
    lang: 'ko',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url: string = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await (w as WindowClient).navigate(url); return (w as WindowClient).focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
