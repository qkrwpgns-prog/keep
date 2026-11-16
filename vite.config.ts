import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: '/keep/',
  resolve: { alias: { '@domain': fileURLToPath(new URL('./supabase/functions/_shared/domain', import.meta.url)) } },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], globIgnores: ['legacy/**'] },
      manifest: {
        name: '키프 Keep — 약속을 기록하고 지키게 돕는다',
        short_name: '키프',
        description: '친구·지인과의 약속을 증서로 남기고, 기한이 지나면 단계적으로 재촉해 주는 서비스',
        lang: 'ko',
        start_url: '/keep/#/',
        scope: '/keep/',
        display: 'standalone',
        background_color: '#f5f1ea',
        theme_color: '#f5f1ea',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: { target: 'es2020', sourcemap: true },
});
