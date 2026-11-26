import { defineConfig, devices } from '@playwright/test';

export const E2E_WEB_PORT = 5181;
export const E2E_API_PORT = 3311;

/**
 * End-to-end tests on an iPhone 12 viewport (Chromium with mobile emulation).
 * global-setup starts an in-memory MongoDB, the built API and seeds a 5°B with 20 students.
 * Locally it uses the installed Chrome; in CI the Playwright Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${E2E_WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
  },
  projects: [
    {
      name: 'iphone-12',
      use: {
        ...devices['iPhone 12'],
        browserName: 'chromium',
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
  // Production build + preview: no HMR socket that would reload the page when going offline.
  webServer: {
    command: 'pnpm exec vite build && pnpm exec vite preview',
    url: `http://localhost:${E2E_WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      WEB_PORT: String(E2E_WEB_PORT),
      VITE_DEV_API_PROXY: `http://localhost:${E2E_API_PORT}`,
    },
  },
});
