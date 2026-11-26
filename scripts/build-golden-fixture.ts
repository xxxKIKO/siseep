/**
 * Builds packages/shared/test/fixtures/periodo1-5B.json from the anonymized 5°B Excel
 * (apps/api/test/fixtures). It holds, per student, the grade of every activity and what the Excel
 * calculated ("Resumen": calculated C/G/K/O, rounded D/H/L/P, adjustment E/I/M/Q, final F/J/N/R,
 * general average S and "Ojo en" T). No names: only list numbers.
 *
 *   pnpm golden:build
 *
 * Runs with Node's type stripping (node --experimental-strip-types), no extra tooling.
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromApi = createRequire(join(root, 'apps/api/package.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = requireFromApi('exceljs') as typeof import('exceljs');

const SOURCE = 'apps/api/test/fixtures/calificaciones-5B-periodo1.xlsx';
const OUTPUT = 'packages/shared/test/fixtures/periodo1-5B.json';

type FieldKey = 'lenguajes' | 'saberes' | 'etica' | 'humano';
const FIELDS: { sheet: string; key: FieldKey; subject?: string; summary: string[] }[] = [
  // summary columns: calculated, rounded, adjustment, final
  { sheet: 'Lenguajes', key: 'lenguajes', subject: 'ingles', summary: ['C', 'D', 'E', 'F'] },
  { sheet: 'Saberes', key: 'saberes', summary: ['G', 'H', 'I', 'J'] },
  { sheet: 'Ética', key: 'etica', summary: ['K', 'L', 'M', 'N'] },
  { sheet: 'De lo humano', key: 'humano', subject: 'ed_fisica', summary: ['O', 'P', 'Q', 'R'] },
];
const COMPONENT_COLUMNS: Record<string, string[]> = {
  DESEMPENO: ['C', 'D', 'E', 'F', 'G'],
  PROYECTO: ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
  EXAMEN: ['T', 'U'],
  COMPLEMENTARIA: ['W'],
};

const value = (cell: import('exceljs').Cell): unknown => {
  const v = cell.value as unknown;
  if (v && typeof v === 'object') {
    // Formula: its cached result (ExcelJS does not keep cached text results → null).
    if ('formula' in (v as object) || 'sharedFormula' in (v as object)) {
      return (v as { result?: unknown }).result ?? null;
    }
  }
  return v;
};
const num = (cell: import('exceljs').Cell): number | null => {
  const v = value(cell);
  return typeof v === 'number' ? v : null;
};

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(root, SOURCE));
  const sheet = (name: string) => {
    const ws = workbook.getWorksheet(name);
    if (!ws) throw new Error(`Falta la hoja ${name}`);
    return ws;
  };

  // Weights from "Datos" (to check they are the default scheme of section 5).
  const datos = sheet('Datos');
  const weights = {
    DESEMPENO: num(datos.getCell('C11')),
    PROYECTO: num(datos.getCell('C12')),
    EXAMEN: num(datos.getCell('C13')),
    fieldWeight: num(datos.getCell('C14')),
    subjectWeight: num(datos.getCell('C15')),
    lowThreshold: num(datos.getCell('C18')),
  };

  // List numbers in order (row 4 onwards), same rows in the grade sheets (row 5 onwards).
  const lista = sheet('Lista');
  const listNumbers: number[] = [];
  for (let r = 4; r < 100; r++) {
    const n = num(lista.getCell(`A${r}`));
    if (n === null || !value(lista.getCell(`B${r}`))) continue;
    listNumbers.push(n);
  }

  // Activities: every column with a title or grades.
  const activities: {
    id: string;
    fieldKey: FieldKey;
    component: string;
    subjectKey?: string;
    name: string;
  }[] = [];
  const grades = new Map<number, Record<string, number | null>>(listNumbers.map((n) => [n, {}]));
  for (const field of FIELDS) {
    const ws = sheet(field.sheet);
    for (const [component, columns] of Object.entries(COMPONENT_COLUMNS)) {
      if (component === 'COMPLEMENTARIA' && !field.subject) continue;
      for (const column of columns) {
        const cells = listNumbers.map((n, i) => num(ws.getCell(`${column}${5 + i}`)));
        if (cells.every((c) => c === null)) continue;
        const id = `${field.key}:${column}`;
        activities.push({
          id,
          fieldKey: field.key,
          component,
          ...(component === 'COMPLEMENTARIA' ? { subjectKey: field.subject } : {}),
          name: String(value(ws.getCell(`${column}3`)) ?? column),
        });
        listNumbers.forEach((n, i) => {
          grades.get(n)![id] = cells[i] ?? null;
        });
      }
    }
  }

  // Expected results from "Resumen".
  const resumen = sheet('Resumen');
  const students = listNumbers.map((listNumber, i) => {
    const row = 4 + i;
    if (num(resumen.getCell(`A${row}`)) !== listNumber)
      throw new Error(`Resumen fila ${row}: N/L distinto`);
    const expected: Record<string, unknown> = {};
    const overrides: Partial<Record<FieldKey, number>> = {};
    for (const field of FIELDS) {
      const [calc, round, adj, fin] = field.summary;
      expected[field.key] = {
        calculated: num(resumen.getCell(`${calc}${row}`)),
        rounded: num(resumen.getCell(`${round}${row}`)),
        final: num(resumen.getCell(`${fin}${row}`)),
      };
      const adjustment = num(resumen.getCell(`${adj}${row}`));
      if (adjustment !== null) overrides[field.key] = adjustment;
    }
    expected.generalAverage = num(resumen.getCell(`S${row}`));
    // Column T ("Ojo en") has no cached value (text formula). Its formula is
    // ISNUMBER(calculated) AND calculated < Datos!C18, applied here to Excel's cached values.
    const threshold = weights.lowThreshold ?? 7;
    expected.lowFields = FIELDS.filter((field) => {
      const calculated = num(resumen.getCell(`${field.summary[0]}${row}`));
      return calculated !== null && calculated < threshold;
    }).map((field) => field.key);
    return { listNumber, grades: grades.get(listNumber), overrides, expected };
  });

  const fixture = {
    source: `${SOURCE} (anonimizado). Generado con scripts/build-golden-fixture.ts; no editar a mano.`,
    weights,
    activities,
    students,
  };
  writeFileSync(join(root, OUTPUT), `${JSON.stringify(fixture, null, 2)}\n`);
  console.info(
    `Listo: ${students.length} alumnos, ${activities.length} actividades, ${students.length * 4} calificaciones esperadas → ${OUTPUT}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
