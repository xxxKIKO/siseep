import type { Component, FieldKey, GradeStatus, SubjectKey } from '../enums';
import type { GradingField, GradingScheme } from '../schemas/grading-scheme';
import { FIELD_SHORT_NAMES } from '../theme';
import { roundHalfUp, roundTo } from './rounding';

/**
 * Grading engine (section 5 of docs/plan.md). Pure functions: no database, no framework.
 * Reproduces the 5°B Excel exactly when every component has grades; with missing components it
 * gives a "partial" average with the weights spread over what exists (live view only).
 */

export type MainComponent = 'DESEMPENO' | 'PROYECTO' | 'EXAMEN';
export const MAIN_COMPONENTS: readonly MainComponent[] = ['DESEMPENO', 'PROYECTO', 'EXAMEN'];

/** A grade, or null/undefined when the student has none yet (pending). */
export type GradeLike = { status: GradeStatus; score: number | null } | null | undefined;

export interface EngineActivity {
  id: string;
  fieldKey: FieldKey;
  component: Component;
  subjectKey?: SubjectKey | null;
}

export interface EngineGrade {
  activityId: string;
  status: GradeStatus;
  score: number | null;
}

export class GradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingError';
  }
}

// ---------------------------------------------------------------------------
// Step 1: component average
// ---------------------------------------------------------------------------
export interface ComponentAverage {
  /** null when nothing counts (no activities, all EXCUSED or all pending). */
  value: number | null;
  /** Grades that count: SCORED and NOT_DELIVERED (as 0). */
  counted: number;
  /** Activities without a grade for this student. */
  pending: number;
  excused: number;
}

/** Simple average of SCORED and NOT_DELIVERED (0). EXCUSED and pending do not count. */
export function componentAverage(grades: readonly GradeLike[]): ComponentAverage {
  let sum = 0;
  let counted = 0;
  let pending = 0;
  let excused = 0;
  for (const grade of grades) {
    if (!grade) {
      pending++;
    } else if (grade.status === 'EXCUSED') {
      excused++;
    } else {
      sum += grade.status === 'NOT_DELIVERED' ? 0 : (grade.score ?? 0);
      counted++;
    }
  }
  return { value: counted ? sum / counted : null, counted, pending, excused };
}

// ---------------------------------------------------------------------------
// Step 2: field score
// ---------------------------------------------------------------------------
export interface FieldScore {
  /** Field grade (with the complementary subject mixed in). null if there is no data at all. */
  value: number | null;
  /** 0.5·D + 0.2·P + 0.3·E before mixing the complementary subject. */
  base: number | null;
  /** Some component is missing: the weights were spread over the ones that exist. */
  partial: boolean;
  missing: Component[];
}

/**
 * C = 0.5·D + 0.2·P + 0.3·E, and in fields with a complementary subject
 * final = 0.7·C + 0.3·M. Same operation order as the Excel, so results are bit-identical.
 */
export function fieldScore(
  field: Pick<GradingField, 'weights' | 'complementary'>,
  averages: Partial<Record<MainComponent, number | null>>,
  complementary?: number | null,
): FieldScore {
  const present = MAIN_COMPONENTS.filter((c) => averages[c] !== null && averages[c] !== undefined);
  const missing: Component[] = MAIN_COMPONENTS.filter((c) => !present.includes(c));

  let base: number | null = null;
  if (present.length === MAIN_COMPONENTS.length) {
    base =
      averages.DESEMPENO! * field.weights.DESEMPENO +
      averages.PROYECTO! * field.weights.PROYECTO +
      averages.EXAMEN! * field.weights.EXAMEN;
  } else if (present.length > 0) {
    const weight = present.reduce((total, c) => total + field.weights[c], 0);
    base =
      weight > 0
        ? present.reduce((total, c) => total + averages[c]! * field.weights[c], 0) / weight
        : null;
  }

  if (!field.complementary) {
    return { value: base, base, partial: base !== null && missing.length > 0, missing };
  }

  const subject = complementary ?? null;
  if (subject === null) missing.push('COMPLEMENTARIA');
  let value: number | null;
  if (base !== null && subject !== null) {
    value = base * field.complementary.fieldWeight + subject * field.complementary.subjectWeight;
  } else {
    value = base ?? subject; // only one side exists: its weight becomes 100%
  }
  return { value, base, partial: value !== null && missing.length > 0, missing };
}

// ---------------------------------------------------------------------------
// Steps 3-6: student period result
// ---------------------------------------------------------------------------
export type FieldOverrides = Partial<Record<FieldKey, number | null>>;

export interface FieldResult {
  fieldKey: FieldKey;
  components: Record<MainComponent, ComponentAverage>;
  /** Average of the complementary subject (English / PE); null in fields without one. */
  complementary: ComponentAverage | null;
  base: number | null;
  calculated: number | null;
  rounded: number | null;
  override: number | null;
  final: number | null;
  adjusted: boolean;
  partial: boolean;
  missing: Component[];
  /** Activities of the field without a grade for this student. */
  pending: number;
}

export interface StudentPeriodResult {
  fields: FieldResult[];
  /** Average of the 4 finals (with adjustments), 1 decimal. */
  generalAverage: number | null;
  /** Fields whose CALCULATED grade is below lowThreshold (like the Excel). */
  lowFields: FieldKey[];
  /** "Ojo en: Saberes, Ética." or null. */
  legendSuggested: string | null;
  pending: number;
  partial: boolean;
}

/** Step 4: an adjustment is an integer between minFinal and maxFinal (5-10). */
export function assertValidOverride(
  scheme: Pick<GradingScheme, 'minFinal' | 'maxFinal'>,
  value: number | null | undefined,
): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < scheme.minFinal || value > scheme.maxFinal) {
    throw new GradingError(
      `El ajuste debe ser un número entero de ${scheme.minFinal} a ${scheme.maxFinal} (se recibió ${value}).`,
    );
  }
}

/** Full calculation for one student in one period. `grades` are that student's grades. */
export function studentPeriodResult(
  scheme: GradingScheme,
  activities: readonly EngineActivity[],
  grades: readonly EngineGrade[],
  overrides: FieldOverrides = {},
): StudentPeriodResult {
  const gradeBy = new Map(grades.map((g) => [g.activityId, g]));
  const gradesOf = (list: readonly EngineActivity[]) => list.map((a) => gradeBy.get(a.id));

  const fields = [...scheme.fields]
    .sort((a, b) => a.order - b.order)
    .map((field): FieldResult => {
      const own = activities.filter((a) => a.fieldKey === field.key);
      const components = Object.fromEntries(
        MAIN_COMPONENTS.map((c) => [
          c,
          componentAverage(gradesOf(own.filter((a) => a.component === c))),
        ]),
      ) as Record<MainComponent, ComponentAverage>;
      const complementary = field.complementary
        ? componentAverage(gradesOf(own.filter((a) => a.component === 'COMPLEMENTARIA')))
        : null;
      const score = fieldScore(
        field,
        {
          DESEMPENO: components.DESEMPENO.value,
          PROYECTO: components.PROYECTO.value,
          EXAMEN: components.EXAMEN.value,
        },
        complementary?.value,
      );
      const override = overrides[field.key] ?? null;
      assertValidOverride(scheme, override);
      const rounded =
        score.value === null ? null : roundHalfUp(score.value, scheme.rounding.preDecimals);
      const pending =
        MAIN_COMPONENTS.reduce((n, c) => n + components[c].pending, 0) +
        (complementary?.pending ?? 0);
      return {
        fieldKey: field.key,
        components,
        complementary,
        base: score.base,
        calculated: score.value,
        rounded,
        override,
        final: override ?? rounded,
        adjusted: override !== null,
        partial: score.partial,
        missing: score.missing,
        pending,
      };
    });

  const finals = fields.map((f) => f.final).filter((n): n is number => n !== null);
  const generalAverage = finals.length
    ? roundTo(finals.reduce((a, b) => a + b, 0) / finals.length, 1)
    : null;
  const lowFields = fields
    .filter((f) => f.calculated !== null && f.calculated < scheme.lowThreshold)
    .map((f) => f.fieldKey);

  return {
    fields,
    generalAverage,
    lowFields,
    legendSuggested: lowFields.length
      ? `${scheme.lowLegend} ${lowFields.map((k) => FIELD_SHORT_NAMES[k]).join(', ')}.`
      : null,
    pending: fields.reduce((n, f) => n + f.pending, 0),
    partial: fields.some((f) => f.partial),
  };
}
