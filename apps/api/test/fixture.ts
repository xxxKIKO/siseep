import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

/** Anonymized copy of the 5°B "Calificaciones y Boletas - Periodo I" Excel (see scripts/). */
export const FIXTURE = join(__dirname, 'fixtures/calificaciones-5B-periodo1.xlsx');

export function fixtureBuffer(): Buffer {
  return readFileSync(FIXTURE);
}

/** Loads the fixture, lets the test edit cells, and returns the new file bytes. */
export async function editedFixture(edit: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(fixtureBuffer() as unknown as ArrayBuffer);
  edit(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
