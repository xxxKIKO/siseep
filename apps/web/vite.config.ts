import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Ports come from the single .env at the repo root (PORT = API, WEB_PORT = web), so this
  // project can run next to others by changing only .env.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
  const apiPort = env.PORT || '3000';
  const webPort = Number(env.WEB_PORT || 5173);

  return {
    plugins: [react(), tailwindcss()],
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
