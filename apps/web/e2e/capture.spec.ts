import { expect, type Page, test } from '@playwright/test';
import { E2E } from './data';

/** 20 values typed with the numeric keyboard (one decimal, NE as 0, 10). */
const VALUES = [
  '9',
  '8.5',
  '10',
  '7',
  '0',
  '9.5',
  '6',
  '8',
  '10',
  '7.5',
  '9',
  '8',
  '5',
  '10',
  '9',
  '8.5',
  '7',
  '9',
  '10',
  '6.5',
];

async function login(page: Page) {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(E2E.teacher.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E.teacher.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/maestro$/);
}

async function newActivity(page: Page, name: string) {
  await page.getByRole('link', { name: /Grupo 5°B/ }).click();
  await page.getByRole('tab', { name: 'Saberes' }).click();
  await page.getByRole('button', { name: 'Actividad' }).click();
  await page.getByLabel('Nombre').fill(name);
  await page.getByRole('button', { name: 'Guardar y capturar' }).click();
  await expect(page).toHaveURL(/\/maestro\/actividades\/[a-f\d]{24}$/);
  await expect(page.getByText('0 de 20 capturados')).toBeVisible();
}

const gradeInputs = (page: Page) => page.getByRole('textbox', { name: /^Calificación de / });

test('captures 20 grades with the keyboard and Enter, and they survive a reload', async ({
  page,
}) => {
  await login(page);
  await newActivity(page, 'Repaso de fracciones');

  await gradeInputs(page).first().click();
  for (const value of VALUES) {
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
  }
  await expect(page.getByText('20 de 20 capturados')).toBeVisible();
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText('20 de 20 capturados')).toBeVisible();
  const shown = await gradeInputs(page).evaluateAll((inputs) =>
    inputs.map((i) => (i as HTMLInputElement).value),
  );
  expect(shown).toEqual(VALUES.map((v) => (v === '0' ? 'NE' : v)));
});

test('rejects 14 while typing and never saves the "1" typed on the way', async ({ page }) => {
  await login(page);
  await newActivity(page, 'Validación');
  const first = gradeInputs(page).first();
  await first.click();
  await page.keyboard.type('1');
  await page.keyboard.type('4');
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('alert')).toContainText('Va de 0 a 10');
  await expect(page.getByText('0 de 20 capturados')).toBeVisible();
  // Past the 2 s debounce and leaving the input: nothing is sent.
  await page.waitForTimeout(2500);
  await first.blur();
  await page.waitForTimeout(500);
  await expect(first).toHaveValue('14');
  await page.reload();
  await expect(page.getByText('0 de 20 capturados')).toBeVisible();
  await expect(gradeInputs(page).first()).toHaveValue('');
});

test('keeps captures made offline and sends them when the connection returns', async ({
  page,
  context,
}) => {
  await login(page);
  await newActivity(page, 'Sin señal');

  await context.setOffline(true);
  const inputs = gradeInputs(page);
  await inputs.nth(0).fill('9');
  await inputs.nth(1).fill('8');
  await inputs.nth(2).fill('7');
  await inputs.nth(2).blur();
  await expect(page.getByText('Sin conexión: 3 cambios por enviar')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Guardado', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText('3 de 20 capturados')).toBeVisible();
  await expect(inputs.nth(0)).toHaveValue('9');
  await expect(inputs.nth(1)).toHaveValue('8');
  await expect(inputs.nth(2)).toHaveValue('7');
});
