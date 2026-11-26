import { describe, expect, it } from 'vitest';
import { dateOnlyToDate, dateToDateOnly } from '../src/dates';
import { DEFAULT_GRADING_SCHEME, gradingSchemeSchema } from '../src/schemas/grading-scheme';

const clone = () => structuredClone(DEFAULT_GRADING_SCHEME);

describe('gradingSchemeSchema', () => {
  it('accepts exactly the JSON of section 5', () => {
    expect(gradingSchemeSchema.parse(DEFAULT_GRADING_SCHEME)).toEqual(DEFAULT_GRADING_SCHEME);
  });

  it('rejects weights that do not add up to 1', () => {
    const scheme = clone();
    scheme.fields[1]!.weights.EXAMEN = 0.4;
    const result = gradingSchemeSchema.safeParse(scheme);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain('deben sumar 100%');
  });

  it('tolerates floating point (0.1 + 0.2 + 0.7)', () => {
    const scheme = clone();
    scheme.fields[0]!.weights = { DESEMPENO: 0.1, PROYECTO: 0.2, EXAMEN: 0.7 };
    expect(gradingSchemeSchema.safeParse(scheme).success).toBe(true);
  });

  it('rejects complementary weights that do not add up to 1', () => {
    const scheme = clone();
    scheme.fields[0]!.complementary!.subjectWeight = 0.4;
    expect(gradingSchemeSchema.safeParse(scheme).success).toBe(false);
  });

  it('requires the 4 fields once each', () => {
    const scheme = clone();
    scheme.fields[3] = { ...scheme.fields[0]! };
    expect(gradingSchemeSchema.safeParse(scheme).success).toBe(false);
    expect(
      gradingSchemeSchema.safeParse({ ...clone(), fields: clone().fields.slice(0, 3) }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(gradingSchemeSchema.safeParse({ ...clone(), extra: 1 }).success).toBe(false);
  });
});

describe('date-only helpers', () => {
  it('stores calendar dates at noon UTC so they never shift a day', () => {
    expect(dateOnlyToDate('2026-11-18').toISOString()).toBe('2026-11-18T12:00:00.000Z');
    expect(dateToDateOnly(dateOnlyToDate('2026-11-18'))).toBe('2026-11-18');
  });
});
