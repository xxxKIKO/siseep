#!/usr/bin/env node
/**
 * Builds the anonymized test fixture from the real "Calificaciones y Boletas - Periodo I" Excel.
 *
 *   node apps/api/scripts/anonymize-workbook.mjs "<real.xlsx>" apps/api/test/fixtures/calificaciones-5B-periodo1.xlsx
 *
 * - Student names are replaced by fictitious ones everywhere (cells and cached formula results).
 * - Observations are replaced by neutral text that keeps the "Lenguajes: / Saberes…:" labels.
 * - Notes, document properties and images are removed.
 * - Grades, adjustments and the cached calculated values are kept EXACTLY, so the fixture can
 *   be used for the importer tests and the golden tests of the grading engine (stage 3).
 * The script fails if any real name token is still present. The real file never enters git.
 */
import ExcelJS from 'exceljs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Uso: node anonymize-workbook.mjs <real.xlsx> <fixture.xlsx>');
  process.exit(1);
}

const FAKE_SURNAMES = [
  'Alvarado',
  'Barrera',
  'Cabrera',
  'Delgado',
  'Escobar',
  'Figueroa',
  'Galindo',
  'Herrera',
  'Ibarra',
  'Jiménez',
  'Lara',
  'Medina',
  'Navarro',
  'Ochoa',
  'Pineda',
  'Quintero',
  'Robles',
  'Salazar',
  'Trejo',
  'Uribe',
  'Valdez',
  'Zamora',
  'Acosta',
  'Bravo',
  'Cortés',
  'Duarte',
  'Espinoza',
  'Fuentes',
  'Gallegos',
  'Huerta',
  'Ledesma',
  'Montes',
  'Núñez',
  'Olvera',
  'Parra',
  'Rangel',
  'Solís',
  'Tapia',
  'Vega',
  'Zúñiga',
];
const FAKE_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Elena',
  'Fabián',
  'Gala',
  'Hugo',
  'Irene',
  'Joel',
  'Karen',
  'Leo',
  'Mara',
  'Nico',
  'Olga',
  'Pablo',
  'Rita',
  'Saúl',
  'Tania',
  'Uriel',
  'Vera',
  'Wendy',
  'Ximena',
  'Yahir',
  'Zoe',
  'Alma',
  'Beto',
  'Celia',
  'Dante',
  'Eva',
  'Félix',
  'Gina',
  'Iker',
  'Julia',
  'Kevin',
  'Lucía',
  'Mateo',
  'Nora',
];

const cellText = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && typeof v.result === 'string') return v.result;
  return null;
};

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(input);

// ---- 1. Real names from "Lista" → fictitious ones with the same number of words -------------
const lista = workbook.getWorksheet('Lista');
const realNames = [];
for (let r = 4; r < 120; r++) {
  const real = cellText(lista.getCell(`B${r}`).value)
    ?.replace(/\s+/g, ' ')
    .trim();
  if (real) realNames.push(real);
}
if (realNames.length === 0) throw new Error('No se encontraron alumnos en la hoja Lista');

// A fictitious word must never be a real one (it would look like a leftover and mix people up).
const realLower = new Set(realNames.flatMap((name) => name.toLowerCase().split(' ')));
const pool = (list) => {
  const safe = list.filter((w) => !realLower.has(w.toLowerCase()));
  let i = 0;
  return () => safe[i++ % safe.length];
};
const nextSurname = pool(FAKE_SURNAMES);
const nextName = pool(FAKE_NAMES);

const fullNames = new Map(); // real → fake
const tokens = new Map(); // real token → fake token
for (const real of realNames) {
  const parts = real.split(' ');
  const fake = [nextSurname(), nextSurname(), ...parts.slice(2).map(() => nextName())];
  fullNames.set(real, fake.join(' '));
  parts.forEach((p, i) => {
    if (p.length >= 3 && !tokens.has(p)) tokens.set(p, fake[i]);
  });
}

// ---- 2. Observations → neutral text keeping the labels ----------------------------------------
const observations = new Map(); // real text → fake text
const obs = workbook.getWorksheet('Observaciones');
for (let r = 4; r < 120; r++) {
  const listNumber = obs.getCell(`A${r}`).value;
  const real = cellText(obs.getCell(`C${r}`).value);
  if (!real) continue;
  const labels = [...real.matchAll(/(^|\n)\s*([^:\n]{2,60}):/g)].map((m) => m[2].trim());
  const fake = labels.length
    ? labels
        .map(
          (label) =>
            `${label}: Observación de prueba del alumno ${listNumber} en ${label.toLowerCase()}.`,
        )
        .join('\n')
    : `Observación general de prueba del alumno ${listNumber}.`;
  observations.set(real.trim(), fake);
}

// ---- 3. Rewrite every text cell and cached result --------------------------------------------
const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenRegex = new RegExp(
  `(?<![\\p{L}])(${[...tokens.keys()].map(escape).join('|')})(?![\\p{L}])`,
  'giu',
);
const tokenLookup = new Map([...tokens].map(([k, v]) => [k.toLowerCase(), v]));
const anonymize = (text) => {
  let out = observations.get(text.trim()) ?? text;
  for (const [real, fake] of fullNames) out = out.split(real).join(fake);
  return out.replace(tokenRegex, (m) => {
    const fake = tokenLookup.get(m.toLowerCase()) ?? m;
    return m === m.toUpperCase() ? fake.toUpperCase() : fake;
  });
};

for (const ws of workbook.worksheets) {
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (typeof v === 'string') cell.value = anonymize(v);
      else if (v && typeof v === 'object' && v.richText) {
        cell.value = { richText: v.richText.map((t) => ({ ...t, text: anonymize(t.text) })) };
      } else if (v && typeof v === 'object' && typeof v.result === 'string') {
        cell.value = { ...v, result: anonymize(v.result) };
      }
      if (cell.note) cell.note = undefined;
    });
  });
  // Images may contain photos or signatures. ExcelJS 4 has no removeImage(): clear the list.
  ws._media = [];
}
for (let r = 4; r < 120; r++) lista.getCell(`C${r}`).value = null; // tutor notes

workbook.creator = 'SISEEP';
workbook.lastModifiedBy = 'SISEEP';
workbook.title = 'Fixture anonimizado 5°B Periodo I';
workbook.media = [];

// ---- 4. Verify nothing real is left ----------------------------------------------------------
const leftovers = new Map();
for (const ws of workbook.worksheets) {
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell.value);
      if (!t) return;
      tokenRegex.lastIndex = 0;
      if (tokenRegex.test(t)) leftovers.set(ws.name, (leftovers.get(ws.name) ?? 0) + 1);
    });
  });
}
if (leftovers.size) {
  console.error('Quedaron nombres reales en:', Object.fromEntries(leftovers));
  process.exit(1);
}

await workbook.xlsx.writeFile(output);
console.info(
  `Fixture listo: ${fullNames.size} alumnos y ${observations.size} observaciones anonimizados → ${output}`,
);
