import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Ports come from the single .env at the repo root (PORT = API, WEB_PORT = web), so this
  // project can run next to others by changing only .env.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const apiPort = env.PORT || '3000';
  const webPort = Number(env.WEB_PORT || 5173);

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Installable app (stage 6). Only the app shell is precached; API responses are never
      // cached by the service worker (the offline grade queue lives in IndexedDB, stage 2).
      ...(mode === 'test'
        ? []
        : [
            VitePWA({
              registerType: 'autoUpdate',
              injectRegister: 'script-defer',
              includeAssets: ['favicon.svg', 'robots.txt', 'icons/apple-touch-icon.png'],
              manifest: {
                name: 'Evaluación Allende',
                short_name: 'Evaluación',
                description:
                  'Calificaciones, notas y boletas de la Esc. Prim. Fed. Dr. Salvador Allende T.M.',
                lang: 'es-MX',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                orientation: 'portrait',
                theme_color: '#1F3A7A',
                background_color: '#F5F6FA',
                icons: [
                  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  {
                    src: '/icons/icon-maskable-512.png',
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [],
                cleanupOutdatedCaches: true,
              },
            }),
          ]),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: webPort,
      // Fail instead of silently taking another port (WEB_ORIGIN / WEB_URL must match).
      strictPort: true,
      // Same-origin in development, like the Vercel rewrite in staging: the refresh cookie is
      // SameSite=Strict and scoped to /api/v1/auth.
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY ?? `http://localhost:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    build: { target: 'es2022' },
    preview: { port: webPort, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Process react-router through Vite so it shares the same React instance as the app.
      server: { deps: { inline: ['react-router'] } },
    },
  };
});
