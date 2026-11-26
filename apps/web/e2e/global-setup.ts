import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { E2E_API_PORT, E2E_WEB_PORT } from '../playwright.config';
import { E2E } from './data';

const API_DIR = fileURLToPath(new URL('../../api', import.meta.url));
const API = `http://localhost:${E2E_API_PORT}/api/v1`;

export interface E2EGlobals {
  replSet: MongoMemoryReplSet;
  api: ChildProcess;
}

async function waitFor(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function call<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  form?: FormData,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** In-memory MongoDB + built API + seed + a 5°B with the 20 students of the anonymized Excel. */
export default async function globalSetup(): Promise<void> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: 'rs0' } });
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    PORT: String(E2E_API_PORT),
    MONGODB_URI: replSet.getUri('siseep_e2e'),
    JWT_ACCESS_SECRET: 'e2e-secret-that-is-long-enough-1234567890',
    WEB_ORIGIN: `http://localhost:${E2E_WEB_PORT}`,
    WEB_URL: `http://localhost:${E2E_WEB_PORT}`,
    MAIL_DRIVER: 'console',
    SWAGGER_ENABLED: 'false',
    SEED_ADMIN_EMAIL: E2E.admin.email,
    SEED_ADMIN_PASSWORD: E2E.admin.password,
    SEED_DIRECTOR_EMAIL: 'directora@e2e.mx',
    SEED_DIRECTOR_PASSWORD: 'Directora-e2e-2026',
    SEED_TEACHER_EMAIL: E2E.teacher.email,
    SEED_TEACHER_PASSWORD: E2E.teacher.password,
  };

  const seed = spawn(process.execPath, ['dist/scripts/seed.js'], {
    cwd: API_DIR,
    env,
    stdio: 'inherit',
  });
  await new Promise<void>((resolve, reject) =>
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`)))),
  );

  const api = spawn(process.execPath, ['dist/main.js'], { cwd: API_DIR, env, stdio: 'inherit' });
  (globalThis as unknown as { __E2E__: E2EGlobals }).__E2E__ = { replSet, api };
  await waitFor(`${API}/health`);

  // School data through the API, as the admin.
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(E2E.admin),
  });
  const { accessToken: token } = (await login.json()) as { accessToken: string };

  const today = new Date();
  const startYear = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  const year = await call<{ id: string }>('POST', '/school-years', token, {
    name: `${startYear}-${startYear + 1}`,
    startDate: `${startYear}-08-01`,
    endDate: `${startYear + 1}-07-31`,
    isCurrent: true,
  });
  const period = await call<{ id: string }>('POST', '/periods', token, {
    schoolYearId: year.id,
    number: 1,
    name: 'Periodo I',
    startDate: `${startYear}-08-01`,
    endDate: `${startYear + 1}-07-31`,
  });
  const teachers = await call<{ items: { id: string; email: string }[] }>(
    'GET',
    '/users?role=TEACHER',
    token,
  );
  const teacher = teachers.items.find((u) => u.email === E2E.teacher.email)!;
  const group = await call<{ id: string }>('POST', '/groups', token, {
    schoolYearId: year.id,
    grade: 5,
    letter: 'B',
    homeroomTeacherId: teacher.id,
  });

  const form = new FormData();
  form.append('groupId', group.id);
  form.append('periodId', period.id);
  form.append(
    'file',
    new Blob([readFileSync(join(API_DIR, 'test/fixtures/calificaciones-5B-periodo1.xlsx'))]),
    'fixture.xlsx',
  );
  const preview = await call<{ previewId: string }>(
    'POST',
    '/imports/excel/preview',
    token,
    undefined,
    form,
  );
  await call('POST', '/imports/excel/commit', token, { previewId: preview.previewId });
}
