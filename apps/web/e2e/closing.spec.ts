import { expect, test } from '@playwright/test';
import { E2E } from './data';

test('closing screen: observations, preview of the report card and send to review', async ({
  page,
}) => {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(E2E.teacher.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E.teacher.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/maestro$/);

  await page.getByRole('link', { name: /Grupo 5°B/ }).click();
  await page.getByRole('link', { name: 'Cierre y boletas' }).click();
  await expect(page).toHaveURL(/\/maestro\/grupos\/[a-f\d]{24}\/cierre$/);
  await expect(page.getByRole('heading', { name: 'Cierre · 5°B' })).toBeVisible();
  await expect(page.getByText(/de 20 con observaciones/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('cierre-360.png'), fullPage: false });

  // Write a general observation for the first student and save it.
  const general = page.getByLabel('Observación general').first();
  await general.fill('Trabaja con entusiasmo y ayuda a sus compañeros.');
  const card = page.locator('li').filter({ has: general }).first();
  await card.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  await expect(general).toHaveValue('Trabaja con entusiasmo y ayuda a sus compañeros.');

  // Preview of the whole group in a modal (draft while the period is open).
  await page.getByRole('button', { name: 'Vista previa', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Borrador: el periodo aún no está cerrado.')).toBeVisible();
  const frame = page.frameLocator('iframe[title="Vista previa de la boleta"]');
  await expect(
    frame.getByText('Resultados individuales · Evaluación formativa').first(),
  ).toBeVisible();
  await expect(frame.getByText('Trabaja con entusiasmo y ayuda a sus compañeros.')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('vista-previa-360.png') });
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  // Send to review: activities are locked, adjustments and observations are not.
  await page.getByRole('button', { name: 'Enviar a revisión' }).click();
  await expect(
    page.getByText('Enviado a revisión. Ya no se pueden crear actividades.'),
  ).toBeVisible();
  await expect(page.getByText('En revisión', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar a revisión' })).toHaveCount(0);
  await expect(page.getByLabel('Observación general').first()).toBeEnabled();
  await page
    .getByRole('combobox', { name: /^Ajuste de Lenguajes/ })
    .first()
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('tarjeta-360.png') });
});

test('admin: period status per group, closing blocked by pending grades, reopen with reason', async ({
  page,
}) => {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo electrónico').fill(E2E.admin.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(E2E.admin.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto('/admin/periodos');
  await expect(page.getByRole('heading', { name: 'Periodos' })).toBeVisible();
  const card = page.locator('li').filter({ hasText: '5°B' });
  await expect(card.getByText('En revisión', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('admin-periodos-360.png') });

  // The capture tests left activities without every grade: closing answers 422.
  await card.getByRole('button', { name: 'Cerrar' }).click();
  await expect(page.getByText(/No se puede cerrar 5°B: \d+ campos/)).toBeVisible();

  // Reopen needs a reason.
  await card.getByRole('button', { name: 'Reabrir' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reabrir periodo' }).click();
  await expect(dialog.getByText('Explica el motivo (mínimo 5 caracteres)')).toBeVisible();
  await dialog.getByLabel('Motivo').fill('Faltan calificaciones de inglés');
  await dialog.getByRole('button', { name: 'Reabrir periodo' }).click();
  await expect(page.getByText('Periodo reabierto en 5°B.')).toBeVisible();
  await expect(card.getByText('Abierto', { exact: true })).toBeVisible();
});
