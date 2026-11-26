import {
  type Component,
  FIELD_KEYS,
  FIELD_NAMES,
  type FieldKey,
  type GradeStatus,
  type ImportIssue,
  type SubjectKey,
} from '@siseep/shared';
import ExcelJS from 'exceljs';

// ---------------------------------------------------------------------------
// Layout of the 5°B workbook ("Calificaciones y Boletas - Periodo I")
// ---------------------------------------------------------------------------
export const SHEETS = {
  list: 'Lista',
  summary: 'Resumen',
  observations: 'Observaciones',
  data: 'Datos',
} as const;

/** Grade sheet per formative field, with its complementary subject (column W). */
export const FIELD_SHEETS: {
  sheet: string;
  fieldKey: FieldKey;
  subject?: { key: SubjectKey; name: string };
}[] = [
  { sheet: 'Lenguajes', fieldKey: 'lenguajes', subject: { key: 'ingles', name: 'Inglés' } },
  { sheet: 'Saberes', fieldKey: 'saberes' },
  { sheet: 'Ética', fieldKey: 'etica' },
  {
    sheet: 'De lo humano',
    fieldKey: 'humano',
    subject: { key: 'ed_fisica', name: 'Educación Física' },
  },
];

export const COMPONENT_COLUMNS: Record<Component, string[]> = {
  DESEMPENO: ['C', 'D', 'E', 'F', 'G'],
  PROYECTO: ['I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
  EXAMEN: ['T', 'U'],
  COMPLEMENTARIA: ['W'],
};

const LIST_FIRST_ROW = 4;
const GRADE_TITLE_ROW = 3;
const GRADE_DATE_ROW = 4;
const GRADE_FIRST_ROW = 5;
const SUMMARY_FIRST_ROW = 4;
/** Adjustment column per field in "Resumen". */
const ADJUSTMENT_COLUMNS: Record<FieldKey, string> = {
  lenguajes: 'E',
  saberes: 'I',
  etica: 'M',
  humano: 'Q',
};
const OBSERVATIONS_FIRST_ROW = 4;
const MAX_ROWS = 120;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
export interface ParsedStudent {
  listNumber: number;
  fullName: string;
  lastName1: string;
  lastName2: string;
  firstName: string;
}

export interface ParsedGrade {
  listNumber: number;
  status: GradeStatus;
  score: number | null;
}

/** A date as written in the Excel, before knowing the school year. */
export type LooseDate =
  | { kind: 'exact'; iso: string }
  | { kind: 'dayMonth'; day: number; month: number }
  | { kind: 'month'; month: number }
  | { kind: 'none' };

export interface ParsedActivity {
  fieldKey: FieldKey;
  component: Component;
  subjectKey?: SubjectKey;
  name: string;
  dateText?: string;
  date: LooseDate;
  sheet: string;
  column: string;
  grades: ParsedGrade[];
  pending: number[];
}

export interface ParsedObservation {
  listNumber: number;
  general?: string;
  byField: Partial<Record<FieldKey, string>>;
  legendOverride?: string;
}

export interface ParsedWorkbook {
  meta: {
    school?: string;
    group?: string;
    schoolYear?: string;
    period?: string;
    deliveryDateText?: string;
    teacher?: string;
  };
  students: ParsedStudent[];
  activities: ParsedActivity[];
  adjustments: { listNumber: number; fieldKey: FieldKey; value: number }[];
  observations: ParsedObservation[];
  issues: ImportIssue[];
}

export class WorkbookReadError extends Error {}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------
type Primitive = string | number | boolean | Date | null;

/** Plain value of a cell: formula results, rich text and hyperlinks are unwrapped. */
export function cellValue(cell: ExcelJS.Cell): Primitive {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v !== 'object') return v as Primitive;
  const obj = v as Record<string, unknown>;
  if ('result' in obj) return (obj.result as Primitive) ?? null;
  if ('formula' in obj || 'sharedFormula' in obj) return null;
  if (Array.isArray(obj.richText))
    return (obj.richText as { text: string }[]).map((t) => t.text).join('');
  if ('text' in obj) return String(obj.text);
  if ('error' in obj) return null;
  return null;
}

function text(cell: ExcelJS.Cell): string {
  const v = cellValue(cell);
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
}

function isBlank(v: Primitive): boolean {
  return v === null || (typeof v === 'string' && v.trim() === '');
}

function toNumber(v: Primitive): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v))
    return Number(v.replace(',', '.'));
  return null;
}

// ---------------------------------------------------------------------------
// Names and dates
// ---------------------------------------------------------------------------
const SURNAME_PARTICLES = new Set([
  'de',
  'del',
  'la',
  'las',
  'los',
  'y',
  'mc',
  'san',
  'van',
  'von',
]);

/**
 * Splits "Aguilar Cárdenas Edgar Mateo": the first two words are the surnames, the rest the
 * given names. Compound surnames ("De la Cruz") cannot be told apart, so they are flagged.
 */
export function splitStudentName(fullName: string): {
  lastName1: string;
  lastName2: string;
  firstName: string;
  doubtful: boolean;
} {
  const tokens = fullName.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length <= 1) {
    return { lastName1: tokens[0] ?? '', lastName2: '', firstName: '', doubtful: true };
  }
  if (tokens.length === 2) {
    return { lastName1: tokens[0]!, lastName2: '', firstName: tokens[1]!, doubtful: true };
  }
  const doubtful =
    tokens.length > 4 || tokens.slice(0, 3).some((t) => SURNAME_PARTICLES.has(t.toLowerCase()));
  return {
    lastName1: tokens[0]!,
    lastName2: tokens[1]!,
    firstName: tokens.slice(2).join(' '),
    doubtful,
  };
}

const MONTHS: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  set: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

/** Reads the free-text dates of row 4: "26/oct", "4 nov", "26/10", "oct", or a real date. */
export function parseLooseDate(value: Primitive): LooseDate {
  if (value instanceof Date) return { kind: 'exact', iso: value.toISOString().slice(0, 10) };
  if (isBlank(value)) return { kind: 'none' };
  const raw = String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();

  const full = raw.match(/^(\d{1,2})[/\-\s](\d{1,2})[/\-\s](\d{2,4})$/);
  if (full) {
    const year = Number(full[3]!.length === 2 ? `20${full[3]}` : full[3]);
    const iso = `${year}-${full[2]!.padStart(2, '0')}-${full[1]!.padStart(2, '0')}`;
    if (validDay(Number(full[1]), Number(full[2]))) return { kind: 'exact', iso };
  }
  const dm = raw.match(/^(\d{1,2})\s*(?:[/-]|de)?\s*([a-z]+|\d{1,2})$/);
  if (dm) {
    const day = Number(dm[1]);
    const month = /^\d+$/.test(dm[2]!) ? Number(dm[2]) : MONTHS[dm[2]!];
    if (month && validDay(day, month)) return { kind: 'dayMonth', day, month };
  }
  const monthOnly = MONTHS[raw];
  if (monthOnly) return { kind: 'month', month: monthOnly };
  return { kind: 'none' };
}

function validDay(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * Resolves a loose date inside the school year (Aug-Dec → first year, Jan-Jul → second year).
 * Returns the `YYYY-MM-DD` and whether it had to be completed or replaced.
 */
export function resolveLooseDate(
  date: LooseDate,
  schoolYearStart: number,
  fallback: string,
): { date: string; quality: 'exact' | 'completed' | 'missing' } {
  const yearFor = (month: number) => (month >= 8 ? schoolYearStart : schoolYearStart + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (date.kind) {
    case 'exact':
      return { date: date.iso, quality: 'exact' };
    case 'dayMonth':
      return {
        date: `${yearFor(date.month)}-${pad(date.month)}-${pad(date.day)}`,
        quality: 'exact',
      };
    case 'month':
      return { date: `${yearFor(date.month)}-${pad(date.month)}-01`, quality: 'completed' };
    default:
      return { date: fallback, quality: 'missing' };
  }
}

// ---------------------------------------------------------------------------
// Observations "Lenguajes: … / Saberes y pensamiento científico: …"
// ---------------------------------------------------------------------------
const plainLower = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const FIELD_LABELS: { fieldKey: FieldKey; label: string }[] = FIELD_KEYS.flatMap((key) => {
  const full = plainLower(FIELD_NAMES[key]);
  const short = plainLower(FIELD_SHEETS.find((f) => f.fieldKey === key)!.sheet);
  return [
    { fieldKey: key, label: full },
    { fieldKey: key, label: short },
  ];
}).sort((a, b) => b.label.length - a.label.length);

export function splitObservations(textValue: string): {
  general?: string;
  byField: Partial<Record<FieldKey, string>>;
} {
  const byField: Partial<Record<FieldKey, string>> = {};
  const general: string[] = [];
  let current: FieldKey | null = null;
  for (const line of textValue.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]{2,60}):\s*(.*)$/);
    const label = match ? plainLower(match[1]!) : null;
    const field = label ? FIELD_LABELS.find((f) => f.label === label)?.fieldKey : undefined;
    if (field) {
      current = field;
      byField[field] = [byField[field], match![2]!.trim()].filter(Boolean).join('\n');
    } else if (current) {
      byField[current] = [byField[current], line.trim()].filter(Boolean).join('\n');
    } else if (line.trim()) {
      general.push(line.trim());
    }
  }
  return { ...(general.length ? { general: general.join('\n') } : {}), byField };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
/** Reads the workbook. Never touches the database; DB checks happen in ImportsService. */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new WorkbookReadError(
      'No pudimos leer el archivo. Verifica que sea el Excel de calificaciones (.xlsx). ' +
        'Si tiene imágenes pegadas, guarda una copia sin ellas e inténtalo de nuevo.',
    );
  }

  const issues: ImportIssue[] = [];
  const sheet = (name: string) => workbook.getWorksheet(name);
  const missing = [SHEETS.list, ...FIELD_SHEETS.map((f) => f.sheet)].filter((name) => !sheet(name));
  if (missing.length) {
    throw new WorkbookReadError(
      `El archivo no tiene el formato esperado: faltan las hojas ${missing.map((m) => `"${m}"`).join(', ')}.`,
    );
  }

  const meta = readMeta(workbook);
  const students = readStudents(sheet(SHEETS.list)!, issues);
  const listNumbers = new Set(students.map((s) => s.listNumber));
  const activities = FIELD_SHEETS.flatMap((field) =>
    readFieldSheet(sheet(field.sheet)!, field, students, issues),
  );
  const summary = sheet(SHEETS.summary);
  const adjustments = summary ? readAdjustments(summary, listNumbers, issues) : [];
  if (!summary) {
    issues.push({
      severity: 'warning',
      code: 'NO_SUMMARY',
      message: 'No hay hoja "Resumen": no se importan ajustes.',
    });
  }
  const obsSheet = sheet(SHEETS.observations);
  const observations = obsSheet ? readObservations(obsSheet, listNumbers) : [];

  return { meta, students, activities, adjustments, observations, issues };
}

function readMeta(workbook: ExcelJS.Workbook): ParsedWorkbook['meta'] {
  const ws = workbook.getWorksheet(SHEETS.data);
  if (!ws) return {};
  const values = new Map<string, string>();
  for (let r = 1; r <= 30; r++) {
    const key = plainLower(text(ws.getCell(`B${r}`)));
    if (key) values.set(key, text(ws.getCell(`C${r}`)));
  }
  const get = (key: string) => values.get(key) || undefined;
  return {
    school: get('escuela'),
    group: get('grado y grupo'),
    schoolYear: get('ciclo escolar'),
    period: get('periodo'),
    deliveryDateText: get('fecha de entrega (texto)'),
    teacher: get('docente'),
  };
}

function readStudents(ws: ExcelJS.Worksheet, issues: ImportIssue[]): ParsedStudent[] {
  const students: ParsedStudent[] = [];
  const seen = new Set<number>();
  for (let r = LIST_FIRST_ROW; r < LIST_FIRST_ROW + MAX_ROWS; r++) {
    const fullName = text(ws.getCell(`B${r}`));
    if (!fullName) continue;
    const listNumber = toNumber(cellValue(ws.getCell(`A${r}`)));
    const cell = `A${r}`;
    if (listNumber === null || !Number.isInteger(listNumber) || listNumber < 1 || listNumber > 99) {
      issues.push({
        severity: 'error',
        code: 'INVALID_LIST_NUMBER',
        blocking: true,
        sheet: SHEETS.list,
        cell,
        message: `"${fullName}" no tiene un N/L válido.`,
      });
      continue;
    }
    if (seen.has(listNumber)) {
      issues.push({
        severity: 'error',
        code: 'DUPLICATE_LIST_NUMBER',
        blocking: true,
        sheet: SHEETS.list,
        cell,
        listNumber,
        message: `El N/L ${listNumber} está repetido en la lista.`,
      });
      continue;
    }
    seen.add(listNumber);
    const parts = splitStudentName(fullName);
    if (parts.doubtful) {
      issues.push({
        severity: 'warning',
        code: 'NAME_SPLIT',
        sheet: SHEETS.list,
        cell: `B${r}`,
        listNumber,
        message: `Revisa cómo se separó "${fullName}": apellidos "${[parts.lastName1, parts.lastName2].filter(Boolean).join(' ')}", nombre(s) "${parts.firstName}".`,
      });
    }
    students.push({ listNumber, fullName, ...parts });
  }
  if (students.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_STUDENTS',
      blocking: true,
      sheet: SHEETS.list,
      message:
        'La hoja "Lista" no tiene alumnos (N/L en la columna A y nombre en la B, desde la fila 4).',
    });
  }
  return students;
}

/** Rows of a grade sheet mapped to list numbers (column A; by row order if A is empty). */
function studentRows(ws: ExcelJS.Worksheet, students: ParsedStudent[]): Map<number, number> {
  const rows = new Map<number, number>();
  const known = new Set(students.map((s) => s.listNumber));
  for (let r = GRADE_FIRST_ROW, index = 0; r < GRADE_FIRST_ROW + MAX_ROWS; r++, index++) {
    const fromA = toNumber(cellValue(ws.getCell(`A${r}`)));
    const listNumber = fromA ?? students[index]?.listNumber;
    if (listNumber !== undefined && known.has(listNumber) && !rows.has(listNumber)) {
      if (text(ws.getCell(`B${r}`)) || fromA !== null) rows.set(listNumber, r);
    }
  }
  return rows;
}

function readFieldSheet(
  ws: ExcelJS.Worksheet,
  field: (typeof FIELD_SHEETS)[number],
  students: ParsedStudent[],
  issues: ImportIssue[],
): ParsedActivity[] {
  const rows = studentRows(ws, students);
  const activities: ParsedActivity[] = [];
  const usedNames = new Map<string, number>();

  for (const [component, columns] of Object.entries(COMPONENT_COLUMNS) as [Component, string[]][]) {
    for (const column of columns) {
      const title = text(ws.getCell(`${column}${GRADE_TITLE_ROW}`));
      const values = students.map((s) => {
        const row = rows.get(s.listNumber);
        return {
          listNumber: s.listNumber,
          row,
          value: row ? cellValue(ws.getCell(`${column}${row}`)) : null,
        };
      });
      const filled = values.filter((v) => !isBlank(v.value));
      if (filled.length === 0) continue; // a column without grades is not an activity

      if (component === 'COMPLEMENTARIA' && !field.subject) {
        issues.push({
          severity: 'error',
          code: 'UNEXPECTED_COMPLEMENTARY',
          sheet: ws.name,
          cell: `${column}${GRADE_TITLE_ROW}`,
          message: `"${ws.name}" no lleva materia complementaria: la columna ${column} no se importa.`,
        });
        continue;
      }

      let name =
        component === 'COMPLEMENTARIA'
          ? field.subject!.name
          : title || `Actividad sin nombre (${column})`;
      if (!title && component !== 'COMPLEMENTARIA') {
        issues.push({
          severity: 'warning',
          code: 'UNNAMED_ACTIVITY',
          sheet: ws.name,
          cell: `${column}${GRADE_TITLE_ROW}`,
          message: `La columna ${column} de "${ws.name}" tiene calificaciones pero no nombre; se importará como "${name}".`,
        });
      }
      const key = `${component}|${name.toLowerCase()}`;
      const repeats = (usedNames.get(key) ?? 0) + 1;
      usedNames.set(key, repeats);
      if (repeats > 1) {
        const renamed = `${name} (${repeats})`;
        issues.push({
          severity: 'warning',
          code: 'DUPLICATE_ACTIVITY',
          sheet: ws.name,
          cell: `${column}${GRADE_TITLE_ROW}`,
          message: `"${name}" se repite en ${ws.name}; la columna ${column} se importará como "${renamed}".`,
        });
        name = renamed;
      }

      const dateRaw = cellValue(ws.getCell(`${column}${GRADE_DATE_ROW}`));
      const grades: ParsedGrade[] = [];
      const pending: number[] = [];
      for (const { listNumber, row, value } of values) {
        const cell = `${column}${row ?? '?'}`;
        if (isBlank(value)) {
          pending.push(listNumber);
          continue;
        }
        const parsed = readGradeValue(value);
        if (parsed.kind === 'invalid') {
          issues.push({
            severity: 'error',
            code: parsed.code,
            sheet: ws.name,
            cell,
            listNumber,
            message: `${ws.name} / "${name}", N/L ${listNumber}: ${parsed.message} No se importa esa calificación.`,
          });
          pending.push(listNumber);
          continue;
        }
        if (parsed.kind === 'scored' && Math.round(parsed.score * 10) !== parsed.score * 10) {
          issues.push({
            severity: 'warning',
            code: 'MORE_THAN_ONE_DECIMAL',
            sheet: ws.name,
            cell,
            listNumber,
            message: `${ws.name} / "${name}", N/L ${listNumber}: ${parsed.score} tiene más de un decimal (se importa igual).`,
          });
        }
        grades.push({
          listNumber,
          status:
            parsed.kind === 'scored'
              ? parsed.score === 0
                ? 'NOT_DELIVERED'
                : 'SCORED'
              : parsed.status,
          score:
            parsed.kind === 'scored' ? parsed.score : parsed.status === 'NOT_DELIVERED' ? 0 : null,
        });
      }
      if (pending.length && grades.length) {
        issues.push({
          severity: 'warning',
          code: 'PENDING_GRADES',
          sheet: ws.name,
          cell: `${column}${GRADE_TITLE_ROW}`,
          message: `${ws.name} / "${name}": sin calificación para N/L ${pending.join(', ')} (quedan pendientes).`,
        });
      }

      activities.push({
        fieldKey: field.fieldKey,
        component,
        ...(component === 'COMPLEMENTARIA' ? { subjectKey: field.subject!.key } : {}),
        name,
        ...(isBlank(dateRaw)
          ? {}
          : {
              dateText:
                dateRaw instanceof Date
                  ? dateRaw.toISOString().slice(0, 10)
                  : String(dateRaw).trim(),
            }),
        date: parseLooseDate(dateRaw),
        sheet: ws.name,
        column,
        grades,
        pending,
      });
    }
  }
  return activities;
}

type GradeRead =
  | { kind: 'scored'; score: number }
  | { kind: 'status'; status: GradeStatus }
  | { kind: 'invalid'; code: string; message: string };

/** Number 0-10 (0 = not delivered), or "NE" / "NA" codes. */
function readGradeValue(value: Primitive): GradeRead {
  const n = toNumber(value);
  if (n !== null) {
    if (n < 0 || n > 10)
      return {
        kind: 'invalid',
        code: 'OUT_OF_RANGE',
        message: `el valor ${n} está fuera de 0 a 10.`,
      };
    return { kind: 'scored', score: n };
  }
  const code = plainLower(String(value)).replace(/\./g, '');
  if (code === 'ne' || code === 'no entrego') return { kind: 'status', status: 'NOT_DELIVERED' };
  if (code === 'na' || code === 'no aplica' || code === 'exc')
    return { kind: 'status', status: 'EXCUSED' };
  return {
    kind: 'invalid',
    code: 'NOT_A_NUMBER',
    message: `"${String(value)}" no es una calificación.`,
  };
}

function readAdjustments(
  ws: ExcelJS.Worksheet,
  listNumbers: Set<number>,
  issues: ImportIssue[],
): ParsedWorkbook['adjustments'] {
  const adjustments: ParsedWorkbook['adjustments'] = [];
  for (let r = SUMMARY_FIRST_ROW; r < SUMMARY_FIRST_ROW + MAX_ROWS; r++) {
    const listNumber = toNumber(cellValue(ws.getCell(`A${r}`)));
    if (listNumber === null || !listNumbers.has(listNumber)) continue;
    for (const fieldKey of FIELD_KEYS) {
      const column = ADJUSTMENT_COLUMNS[fieldKey];
      const raw = cellValue(ws.getCell(`${column}${r}`));
      if (isBlank(raw)) continue;
      const value = toNumber(raw);
      if (value === null || !Number.isInteger(value) || value < 5 || value > 10) {
        issues.push({
          severity: 'error',
          code: 'INVALID_ADJUSTMENT',
          sheet: SHEETS.summary,
          cell: `${column}${r}`,
          listNumber,
          message: `Ajuste de ${FIELD_NAMES[fieldKey]}, N/L ${listNumber}: "${String(raw)}" debe ser un entero de 5 a 10. No se importa.`,
        });
        continue;
      }
      adjustments.push({ listNumber, fieldKey, value });
    }
  }
  return adjustments;
}

function readObservations(ws: ExcelJS.Worksheet, listNumbers: Set<number>): ParsedObservation[] {
  const observations: ParsedObservation[] = [];
  for (let r = OBSERVATIONS_FIRST_ROW; r < OBSERVATIONS_FIRST_ROW + MAX_ROWS; r++) {
    const listNumber = toNumber(cellValue(ws.getCell(`A${r}`)));
    if (listNumber === null || !listNumbers.has(listNumber)) continue;
    const raw = cellValue(ws.getCell(`C${r}`));
    const legend = text(ws.getCell(`D${r}`));
    const body = isBlank(raw) ? '' : String(raw).trim();
    if (!body && !legend) continue;
    observations.push({
      listNumber,
      ...splitObservations(body),
      ...(legend ? { legendOverride: legend } : {}),
    });
  }
  return observations;
}
