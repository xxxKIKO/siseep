import { describe, expect, it } from 'vitest';
import type { Component, FieldKey, SubjectKey } from '../src/enums';
import {
  componentAverage,
  type EngineActivity,
  type EngineGrade,
  fieldScore,
  GradingError,
  roundHalfUp,
  roundTo,
  studentPeriodResult,
} from '../src/grading';
import { DEFAULT_GRADING_SCHEME, type GradingScheme } from '../src/schemas/grading-scheme';
import fixture from './fixtures/periodo1-5B.json';

// GOLDEN TESTS OF THE GRADING ENGINE: never delete, skip or relax them (see CLAUDE.md).
// They compare the engine with what the 5°B Excel calculated in Periodo I.

const scheme = DEFAULT_GRADING_SCHEME;
const activities: EngineActivity[] = fixture.activities.map((a) => ({
  id: a.id,
  fieldKey: a.fieldKey as FieldKey,
  component: a.component as Component,
  subjectKey: (a.subjectKey ?? null) as SubjectKey | null,
}));
const FIELDS: FieldKey[] = ['lenguajes', 'saberes', 'etica', 'humano'];

/** The Excel cell → a grade: 0 is "no entregó", empty is pending. */
function gradesOf(student: (typeof fixture.students)[number]): EngineGrade[] {
  return Object.entries(student.grades).flatMap(([activityId, value]) =>
    value === null
      ? []
      : [
          {
            activityId,
            status: value === 0 ? ('NOT_DELIVERED' as const) : ('SCORED' as const),
            score: value,
          },
        ],
  );
}

const results = fixture.students.map((student) => ({
  student,
  result: studentPeriodResult(scheme, activities, gradesOf(student), student.overrides),
}));

describe('golden fixture', () => {
  it('uses the same weights as the Excel ("Datos")', () => {
    expect(fixture.weights).toEqual({
      DESEMPENO: 0.5,
      PROYECTO: 0.2,
      EXAMEN: 0.3,
      fieldWeight: 0.7,
      subjectWeight: 0.3,
      lowThreshold: 7,
    });
    expect(fixture.students).toHaveLength(20);
    expect(fixture.activities).toHaveLength(30);
  });
});

describe('Periodo I of 5°B: the 80 grades match the Excel', () => {
  const cases = results.flatMap(({ student, result }) =>
    FIELDS.map((fieldKey) => ({
      label: `N/L ${student.listNumber} · ${fieldKey}`,
      expected: student.expected[fieldKey as keyof typeof student.expected] as {
        calculated: number;
        rounded: number;
        final: number;
      },
      actual: result.fields.find((f) => f.fieldKey === fieldKey)!,
    })),
  );

  it('has 80 field grades to compare', () => {
    expect(cases).toHaveLength(80);
  });

  it.each(cases)('$label: calculated (4 decimals) and rounded (exact)', ({ expected, actual }) => {
    expect(actual.partial).toBe(false);
    expect(actual.calculated).toBeCloseTo(expected.calculated, 4);
    expect(actual.rounded).toBe(expected.rounded);
    expect(actual.final).toBe(expected.final);
  });

  it.each(results.map(({ student, result }) => ({ n: student.listNumber, student, result })))(
    'N/L $n: general average and "Ojo en"',
    ({ student, result }) => {
      expect(result.generalAverage).toBe(student.expected.generalAverage);
      expect(result.lowFields).toEqual(student.expected.lowFields);
    },
  );
});

describe('values checked by hand (section 5)', () => {
  const field = (listNumber: number, key: FieldKey) =>
    results
      .find((r) => r.student.listNumber === listNumber)!
      .result.fields.find((f) => f.fieldKey === key)!;

  it('Aguilar (N/L 1), Lenguajes: D 8.8, P 9.125, E 8 → 8.625 → 0.7·8.625 + 0.3·10 = 9.0375 → 9', () => {
    const lenguajes = field(1, 'lenguajes');
    expect(lenguajes.components.DESEMPENO.value).toBeCloseTo(8.8, 10);
    expect(lenguajes.components.PROYECTO.value).toBeCloseTo(9.125, 10);
    expect(lenguajes.components.EXAMEN.value).toBe(8);
    expect(lenguajes.base).toBeCloseTo(8.625, 10);
    expect(lenguajes.complementary?.value).toBe(10);
    expect(lenguajes.calculated).toBeCloseTo(9.0375, 10);
    expect(lenguajes.rounded).toBe(9);
  });

  it('Aguilar (N/L 1), De lo humano: 9.0725 → 9, adjusted by the teacher to 10*', () => {
    const humano = field(1, 'humano');
    expect(humano.calculated).toBeCloseTo(9.0725, 10);
    expect(humano.rounded).toBe(9);
    expect(humano).toMatchObject({ override: 10, final: 10, adjusted: true });
  });

  it('Álvarez (N/L 2): Saberes ≈ 5.93 → 6 and Ética ≈ 4.42 → 4', () => {
    expect(field(2, 'saberes').calculated).toBeCloseTo(5.93, 2);
    expect(field(2, 'saberes').rounded).toBe(6);
    expect(field(2, 'etica').calculated).toBeCloseTo(4.425, 4);
    expect(field(2, 'etica').rounded).toBe(4);
  });

  it('Monroy (N/L 12): Ética ≈ 9.34 → 9', () => {
    expect(field(12, 'etica').calculated).toBeCloseTo(9.335, 4);
    expect(field(12, 'etica').rounded).toBe(9);
  });

  it('suggests "Ojo en" from the calculated grade', () => {
    const alvarez = results.find((r) => r.student.listNumber === 2)!.result;
    expect(alvarez.legendSuggested).toBe('Ojo en: Saberes, Ética.');
    expect(results.find((r) => r.student.listNumber === 1)!.result.legendSuggested).toBeNull();
  });
});

describe('roundHalfUp (step 3)', () => {
  it.each([
    [9.4999999, 10], // 9.4999999 → 9.5 → 10
    [8.45, 8],
    [8.5, 9],
    [9.0375, 9],
    [9.0725, 9],
    [5.93, 6],
    [4.425, 4],
    [0.49995, 1], // 0.49995 → 0.5000 → 1
    [0.49994, 0],
    [10, 10],
    [0, 0],
  ])('%s → %s', (input, expected) => {
    expect(roundHalfUp(input)).toBe(expected);
  });

  it('is not fooled by binary floating point', () => {
    // 0.1 + 0.2 + 0.2 = 0.5000000000000001 in binary; 1.005 is 1.00499999999999989 in binary.
    expect(roundHalfUp(0.1 + 0.2 + 0.2)).toBe(1);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(8.25, 1)).toBe(8.3);
    expect(roundTo(8.75, 1)).toBe(8.8);
    expect(roundTo(-2.5, 0)).toBe(-3);
  });

  it('rejects non-finite numbers', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(RangeError);
  });
});

describe('edge cases', () => {
  const field = scheme.fields.find((f) => f.key === 'saberes')!;
  const lenguajes = scheme.fields.find((f) => f.key === 'lenguajes')!;
  const act = (
    id: string,
    fieldKey: FieldKey,
    component: Component,
    subjectKey?: SubjectKey,
  ): EngineActivity => ({
    id,
    fieldKey,
    component,
    subjectKey: subjectKey ?? null,
  });
  const scored = (activityId: string, score: number): EngineGrade => ({
    activityId,
    status: 'SCORED',
    score,
  });

  it('componentAverage: NOT_DELIVERED counts as 0; EXCUSED and pending do not count', () => {
    expect(
      componentAverage([
        { status: 'SCORED', score: 10 },
        { status: 'NOT_DELIVERED', score: 0 },
        { status: 'EXCUSED', score: null },
        null,
      ]),
    ).toEqual({ value: 5, counted: 2, pending: 1, excused: 1 });
  });

  it('a component without activities has no value', () => {
    expect(componentAverage([])).toEqual({ value: null, counted: 0, pending: 0, excused: 0 });
  });

  it('all EXCUSED has no value (and does not count as 0)', () => {
    expect(
      componentAverage([
        { status: 'EXCUSED', score: null },
        { status: 'EXCUSED', score: null },
      ]).value,
    ).toBeNull();
  });

  it('missing component → partial with the weights spread over what exists', () => {
    // No exam yet: (0.5·8 + 0.2·10) / 0.7 = 8.5714…
    const score = fieldScore(field, { DESEMPENO: 8, PROYECTO: 10, EXAMEN: null });
    expect(score.partial).toBe(true);
    expect(score.missing).toEqual(['EXAMEN']);
    expect(score.value).toBeCloseTo(6 / 0.7, 10);
  });

  it('missing complementary subject → partial, the field counts 100%', () => {
    const score = fieldScore(lenguajes, { DESEMPENO: 8, PROYECTO: 8, EXAMEN: 8 }, null);
    expect(score).toMatchObject({ value: 8, partial: true, missing: ['COMPLEMENTARIA'] });
  });

  it('no data at all → no value and not partial', () => {
    expect(fieldScore(field, {})).toEqual({
      value: null,
      base: null,
      partial: false,
      missing: ['DESEMPENO', 'PROYECTO', 'EXAMEN'],
    });
  });

  it('a student with everything EXCUSED in a component gets a partial field', () => {
    const acts = [
      act('d', 'saberes', 'DESEMPENO'),
      act('p', 'saberes', 'PROYECTO'),
      act('e', 'saberes', 'EXAMEN'),
    ];
    const result = studentPeriodResult(scheme, acts, [
      scored('d', 9),
      scored('p', 9),
      { activityId: 'e', status: 'EXCUSED', score: null },
    ]);
    const saberes = result.fields.find((f) => f.fieldKey === 'saberes')!;
    expect(saberes).toMatchObject({
      calculated: 9,
      rounded: 9,
      partial: true,
      missing: ['EXAMEN'],
      pending: 0,
    });
  });

  it('counts pending grades per field', () => {
    const acts = [act('d1', 'etica', 'DESEMPENO'), act('d2', 'etica', 'DESEMPENO')];
    const result = studentPeriodResult(scheme, acts, [scored('d1', 7)]);
    expect(result.fields.find((f) => f.fieldKey === 'etica')!.pending).toBe(1);
    expect(result.pending).toBe(1);
  });

  it.each([4, 11, 7.5, -1])(
    'rejects an adjustment of %s (must be an integer from 5 to 10)',
    (override) => {
      expect(() => studentPeriodResult(scheme, [], [], { saberes: override })).toThrow(
        GradingError,
      );
    },
  );

  it('accepts adjustments from 5 to 10 and uses them for the general average', () => {
    const acts = [
      act('d', 'saberes', 'DESEMPENO'),
      act('p', 'saberes', 'PROYECTO'),
      act('e', 'saberes', 'EXAMEN'),
    ];
    const result = studentPeriodResult(
      scheme,
      acts,
      [scored('d', 6), scored('p', 6), scored('e', 6)],
      {
        saberes: 5,
      },
    );
    const saberes = result.fields.find((f) => f.fieldKey === 'saberes')!;
    expect(saberes).toMatchObject({ rounded: 6, override: 5, final: 5, adjusted: true });
    expect(result.generalAverage).toBe(5);
    expect(result.legendSuggested).toBe('Ojo en: Saberes.');
  });

  it('honours a custom scheme (weights, threshold and legend)', () => {
    const custom: GradingScheme = {
      ...scheme,
      lowThreshold: 9,
      lowLegend: 'Reforzar:',
      fields: scheme.fields.map((f) =>
        f.key === 'saberes' ? { ...f, weights: { DESEMPENO: 0.4, PROYECTO: 0.2, EXAMEN: 0.4 } } : f,
      ),
    };
    const acts = [
      act('d', 'saberes', 'DESEMPENO'),
      act('p', 'saberes', 'PROYECTO'),
      act('e', 'saberes', 'EXAMEN'),
    ];
    const result = studentPeriodResult(custom, acts, [
      scored('d', 10),
      scored('p', 5),
      scored('e', 8),
    ]);
    expect(result.fields.find((f) => f.fieldKey === 'saberes')!.calculated).toBeCloseTo(8.2, 10);
    expect(result.legendSuggested).toBe('Reforzar: Saberes.');
  });
});
