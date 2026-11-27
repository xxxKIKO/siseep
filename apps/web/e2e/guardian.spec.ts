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

let code = '';
let childName = '';

/**
 * Setup through the API, as the admin: grade whatever the other e2e tests left pending, close and
 * publish Periodo I of 5°B, and generate a guardian code for N/L 1.
 */
test.beforeAll(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(E2E.admin),
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
  const invitation = await call<{ code: string }>('POST', '/invitations/guardian', token, {
    studentId: first.student.id,
  });
  code = invitation.code;
});

test('a parent redeems the code, sees their child and downloads the published report card', async ({
  page,
}) => {
  await page.goto(`/registro?codigo=${code}`);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByText('Vas a vincularte con:')).toBeVisible();
  await expect(page.getByText(/, 5°B$/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('registro-360.png') });

  await page.getByLabel('Tu nombre').fill('Laura');
  await page.getByLabel('Tus apellidos').fill('Familia Prueba');
  await page.getByLabel('Parentesco').selectOption('MADRE');
  await page.getByLabel('Correo electrónico').fill('laura.familia@e2e.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('Familia-e2e-2026');
  await page.getByLabel('Repite la contraseña').fill('Familia-e2e-2026');
  // Without accepting the privacy notice it does not continue.
  await page.getByRole('button', { name: 'Crear cuenta y vincular' }).click();
  await expect(page.getByText('Para continuar acepta el aviso de privacidad')).toBeVisible();
  await page.getByLabel(/Leí y acepto el/).check();
  await page.getByRole('button', { name: 'Crear cuenta y vincular' }).click();

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
