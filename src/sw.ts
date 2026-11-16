/// <reference lib="webworker" />
// 서비스 워커: 앱 셸 오프라인 캐시 (2단계에서 푸시 알림 수신 추가)
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting(); });
