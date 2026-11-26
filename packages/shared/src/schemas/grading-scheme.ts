import { z } from 'zod';
import { FIELD_KEYS, SUBJECT_KEYS } from '../enums';

/** Two weights are equal when they differ by less than this (avoids 0.1 + 0.2 issues). */
const WEIGHT_TOLERANCE = 1e-9;
const sumsToOne = (values: number[]) =>
  Math.abs(values.reduce((total, value) => total + value, 0) - 1) < WEIGHT_TOLERANCE;

const weight = z
  .number({ message: 'Escribe un número' })
  .min(0, { message: 'El peso no puede ser negativo' })
  .max(1, { message: 'El peso no puede ser mayor a 1' });

export const componentWeightsSchema = z
  .object({ DESEMPENO: weight, PROYECTO: weight, EXAMEN: weight })
  .strict()
  .refine((w) => sumsToOne([w.DESEMPENO, w.PROYECTO, w.EXAMEN]), {
    message: 'Desempeño + proyectos + exámenes deben sumar 100%',
  });

export const complementarySchema = z
  .object({
    subjectKey: z.enum(SUBJECT_KEYS),
    name: z.string().trim().min(1).max(60),
    fieldWeight: weight,
    subjectWeight: weight,
  })
  .strict()
  .refine((c) => sumsToOne([c.fieldWeight, c.subjectWeight]), {
    message: 'El peso del campo + el de la materia complementaria deben sumar 100%',
  });

export const gradingFieldSchema = z
  .object({
    key: z.enum(FIELD_KEYS),
    name: z.string().trim().min(1).max(80),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'Color inválido (#RRGGBB)' }),
    order: z.number().int().min(1).max(10),
    weights: componentWeightsSchema,
    complementary: complementarySchema.optional(),
  })
  .strict();

/** Grading rules per school year: exactly the JSON of section 5 of docs/plan.md. */
export const gradingSchemeSchema = z
  .object({
    fields: z.array(gradingFieldSchema).length(4, { message: 'Deben ser los 4 campos formativos' }),
    rounding: z
      .object({ preDecimals: z.number().int().min(0).max(10), mode: z.literal('HALF_UP') })
      .strict(),
    lowThreshold: z.number().min(0).max(10),
    lowLegend: z.string().trim().min(1).max(80),
    minFinal: z.number().int().min(0).max(10),
    maxFinal: z.number().int().min(0).max(10),
  })
  .strict()
  .refine((s) => new Set(s.fields.map((f) => f.key)).size === s.fields.length, {
    message: 'Cada campo formativo debe aparecer una sola vez',
    path: ['fields'],
  })
  .refine((s) => s.minFinal <= s.maxFinal, {
    message: 'La calificación mínima no puede ser mayor que la máxima',
    path: ['minFinal'],
  });
export type GradingScheme = z.infer<typeof gradingSchemeSchema>;
export type GradingField = z.infer<typeof gradingFieldSchema>;

/** Default rules (Excel of 5°B). New school years start with these. */
export const DEFAULT_GRADING_SCHEME: GradingScheme = {
  fields: [
    {
      key: 'lenguajes',
      name: 'Lenguajes',
      color: '#F8CBAD',
      order: 1,
      weights: { DESEMPENO: 0.5, PROYECTO: 0.2, EXAMEN: 0.3 },
      complementary: { subjectKey: 'ingles', name: 'Inglés', fieldWeight: 0.7, subjectWeight: 0.3 },
    },
    {
      key: 'saberes',
      name: 'Saberes y pensamiento científico',
      color: '#9BC2E6',
      order: 2,
      weights: { DESEMPENO: 0.5, PROYECTO: 0.2, EXAMEN: 0.3 },
    },
    {
      key: 'etica',
      name: 'Ética, naturaleza y sociedades',
      color: '#A9D08E',
      order: 3,
      weights: { DESEMPENO: 0.5, PROYECTO: 0.2, EXAMEN: 0.3 },
    },
    {
      key: 'humano',
      name: 'De lo humano y lo comunitario',
      color: '#B4A7D6',
      order: 4,
      weights: { DESEMPENO: 0.5, PROYECTO: 0.2, EXAMEN: 0.3 },
      complementary: {
        subjectKey: 'ed_fisica',
        name: 'Educación Física',
        fieldWeight: 0.7,
        subjectWeight: 0.3,
      },
    },
  ],
  rounding: { preDecimals: 4, mode: 'HALF_UP' },
  lowThreshold: 7,
  lowLegend: 'Ojo en:',
  minFinal: 5,
  maxFinal: 10,
};
