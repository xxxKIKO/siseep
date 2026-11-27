import { expect, test } from '@playwright/test';
import { E2E_API_PORT } from '../playwright.config';
import { E2E } from './data';

const API = `http://localhost:${E2E_API_PORT}/api/v1`;

async function call<T>(method: string, path: string, token: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

let username = '';
let temporaryPassword = '';
let childName = '';

/**
 * Setup through the API, as the admin: grade whatever the other e2e tests left pending, close and
 * publish Periodo I of 5°B, and create the guardian account of N/L 1 (username + temporary
 * password, as the teacher hands them over).
 */
test.beforeAll(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: E2E.admin.email, password: E2E.admin.password }),
  });
  const { accessToken: token } = (await login.json()) as { accessToken: string };
  const groups = await call<{ id: string; name: string; currentPeriod: { id: string } }[]>(
    'GET',
    '/groups',
    token,
  );
  const group = groups.find((g) => g.name === '5°B')!;
  const periodId = group.currentPeriod.id;
  const results = async () =>
    call<{
      status: string;
      issues: { studentId: string; activityIds: string[] }[];
      rows: { student: { id: string; listNumber: number; shortName: string } }[];
    }>('GET', `/groups/${group.id}/period-results?periodId=${periodId}`, token);

  let view = await results();
  if (view.status !== 'OPEN') {
    await call('POST', `/periods/${periodId}/groups/${group.id}/reopen`, token, {
      reason: 'Preparar prueba del portal de padres',
    });
    view = await results();
  }
  const missing = new Map<string, Set<string>>();
  for (const issue of view.issues) {
    for (const activityId of issue.activityIds) {
      const set = missing.get(activityId) ?? new Set<string>();
      set.add(issue.studentId);
      missing.set(activityId, set);
    }
  }
  for (const [activityId, students] of missing) {
    await call('PUT', `/activities/${activityId}/grades`, token, {
      grades: [...students].map((studentId) => ({ studentId, status: 'SCORED', score: 8 })),
    });
  }
  await call('POST', `/periods/${periodId}/groups/${group.id}/close`, token);
  await call('POST', `/periods/${periodId}/groups/${group.id}/publish`, token);

  const first = view.rows.find((r) => r.student.listNumber === 1)!;
  childName = first.student.shortName;
  // The school creates the guardian account from the student (teacher or direction).
  const account = await call<{ username: string; temporaryPassword: string }>(
    'POST',
    `/students/${first.student.id}/guardians`,
    token,
    {
      firstName: 'Laura',
      lastName: 'Familia Prueba',
      phone: '312 555 0101',
      relationship: 'MADRE',
      address: 'Calle Falsa 123, Colima',
      email: 'laura.familia@e2e.mx',
    },
  );
  username = account.username;
  temporaryPassword = account.temporaryPassword;
});

test('a parent signs in with the username and temporary password, sees their child and downloads the published report card', async ({
  page,
}) => {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Usuario').fill(username.toLowerCase());
  await page.getByLabel('Contraseña', { exact: true }).fill(temporaryPassword);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // First sign-in: choose their own password and accept the privacy notice.
  await expect(page).toHaveURL(/\/cambiar-contrasena$/);
  await expect(page.getByText(`Tu usuario es ${username}`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('primer-ingreso-360.png') });
  await page.getByLabel('Contraseña temporal').fill(temporaryPassword);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('Familia-e2e-2026');
  await page.getByLabel('Repite la nueva contraseña').fill('Familia-e2e-2026');
  await page.getByRole('button', { name: 'Guardar y entrar' }).click();
  await expect(page.getByText('Para continuar acepta el aviso de privacidad.')).toBeVisible();
  await page.getByLabel(/Leí y acepto el/).check();
  await page.getByRole('button', { name: 'Guardar y entrar' }).click();

  // A single child: the portal opens it directly.
  await expect(page).toHaveURL(/\/padres\/hijos\/[a-f\d]{24}$/);
  await expect(page.getByRole('heading', { name: childName })).toBeVisible();
  await expect(page.getByText('en curso').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('avance-360.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Actividades' }).click();
  await expect(page.locator('li').first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('actividades-360.png') });

  await page.getByRole('tab', { name: 'Boletas' }).click();
  await expect(page.getByRole('heading', { name: 'Periodo I' })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('boletas-360.png') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar boleta (PDF)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`Boleta ${childName} - Periodo I.pdf`);
  const path = await file.path();
  expect(path).toBeTruthy();
});
