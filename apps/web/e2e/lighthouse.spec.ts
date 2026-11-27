import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect, test } from '@playwright/test';
import lighthouse from 'lighthouse';
import { E2E_API_PORT, E2E_WEB_PORT } from '../playwright.config';
import { E2E } from './data';

/**
 * Lighthouse on a phone (stage 6 goals: performance ≥ 85, accessibility ≥ 95) on the capture
 * screen and the guardian portal, signed in. Measurement only: `LIGHTHOUSE=1 pnpm test:e2e`.
 * Runs after guardian.spec.ts, which creates the family account it uses.
 */
test.skip(!process.env.LIGHTHOUSE, 'Medición opcional: LIGHTHOUSE=1 pnpm test:e2e');
test.setTimeout(240_000);

const API = `http://localhost:${E2E_API_PORT}/api/v1`;
const WEB = `http://localhost:${E2E_WEB_PORT}`;
const PORT = 9333;

async function session(credentials: { email: string; password: string }) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: credentials.email, password: credentials.password }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
  const { accessToken } = (await res.json()) as { accessToken: string };
  return { cookie, accessToken };
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json()) as T;
}

test('Lighthouse móvil: captura y portal de padres', async () => {
  const teacher = await session(E2E.teacher);
  const groups = await get<{ id: string; currentPeriod: { id: string } }[]>(
    '/groups',
    teacher.accessToken,
  );
  const activities = await get<{ id: string }[]>(
    `/groups/${groups[0]!.id}/activities?periodId=${groups[0]!.currentPeriod.id}`,
    teacher.accessToken,
  );
  const family = await session({ email: 'laura.familia@e2e.mx', password: 'Familia-e2e-2026' });
  const children = await get<{ id: string }[]>('/me/children', family.accessToken);

  const pages = [
    {
      name: 'captura',
      url: `${WEB}/maestro/actividades/${activities[0]!.id}`,
      cookie: teacher.cookie,
    },
    { name: 'padres', url: `${WEB}/padres/hijos/${children[0]!.id}`, cookie: family.cookie },
  ];

  const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
  const results: Record<string, { performance: number; accessibility: number }> = {};
  try {
    for (const target of pages) {
      // The SPA restores the session with the refresh cookie (sent as a header by Lighthouse).
      const run = await lighthouse(target.url, {
        port: PORT,
        output: 'html',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility'],
        formFactor: 'mobile',
        extraHeaders: { Cookie: target.cookie },
      });
      const lhr = run!.lhr;
      results[target.name] = {
        performance: Math.round((lhr.categories.performance?.score ?? 0) * 100),
        accessibility: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      };
      const dir = test.info().outputPath('lighthouse');
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${target.name}.html`, run!.report as string);
    }
  } finally {
    await browser.close();
  }
  console.info('Lighthouse móvil:', JSON.stringify(results));
  test.info().annotations.push({ type: 'lighthouse', description: JSON.stringify(results) });
  for (const scores of Object.values(results)) {
    expect.soft(scores.accessibility).toBeGreaterThanOrEqual(95);
    expect.soft(scores.performance).toBeGreaterThanOrEqual(85);
  }
});
