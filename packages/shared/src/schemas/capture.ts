import { z } from 'zod';
import {
  type Component,
  COMPONENTS,
  FIELD_KEYS,
  type FieldKey,
  GRADE_STATUSES,
  type GradeStatus,
  NOTE_KINDS,
  type NoteKind,
  SUBJECT_KEYS,
  type SubjectKey,
} from '../enums';
import { dateOnlySchema, paginationQuerySchema } from './catalog';
import { objectIdSchema } from './common';

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------
/** Suggested values for "medio" (the teacher can type any other). */
export const ACTIVITY_MEDIUMS = [
  'Libreta',
  'Hoja',
  'Copia',
  'Participación',
  'Exposición',
  'Maqueta',
];

export const activityListQuerySchema = z.object({
  periodId: objectIdSchema,
  fieldKey: z.enum(FIELD_KEYS).optional(),
  component: z.enum(COMPONENTS).optional(),
});
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

const activityName = z
  .string({ message: 'Escribe el nombre' })
  .trim()
  .min(1, { message: 'Escribe el nombre' })
  .max(120, { message: 'Máximo 120 caracteres' });
const optionalShortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Máximo ${max} caracteres` })
    .optional()
    .or(z.literal('').transform(() => undefined));

export const createActivitySchema = z
  .object({
    groupId: objectIdSchema,
    periodId: objectIdSchema,
    fieldKey: z.enum(FIELD_KEYS, { message: 'Elige el campo formativo' }),
    component: z.enum(COMPONENTS, { message: 'Elige el componente' }),
    subjectKey: z.enum(SUBJECT_KEYS).optional(),
    name: activityName,
    date: dateOnlySchema,
    medium: optionalShortText(60),
    description: optionalShortText(500),
    visibleToGuardians: z.boolean().default(true),
  })
  .refine((a) => (a.component === 'COMPLEMENTARIA') === Boolean(a.subjectKey), {
    message: 'La materia complementaria (Inglés o Ed. Física) va solo en ese componente',
    path: ['subjectKey'],
  });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z
  .object({
    name: activityName,
    date: dateOnlySchema,
    medium: z.string().trim().max(60).nullable(),
    description: z.string().trim().max(500).nullable(),
    visibleToGuardians: z.boolean(),
  })
  .partial();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export interface ActivityView {
  id: string;
  groupId: string;
  periodId: string;
  fieldKey: FieldKey;
  component: Component;
  subjectKey?: SubjectKey;
  name: string;
  date: string;
  medium?: string;
  description?: string;
  visibleToGuardians: boolean;
  visibleFrom: string;
  /** Students with a grade (SCORED, NOT_DELIVERED or EXCUSED). */
  gradedCount: number;
  /** Active students of the group ("18/20 capturados"). */
  studentCount: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------
const isOneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;

/** 0-10 with at most one decimal (8.5 yes, 8.55 no, 14 no). */
export const scoreSchema = z
  .number({ message: 'Escribe un número' })
  .min(0, { message: 'La calificación va de 0 a 10' })
  .max(10, { message: 'La calificación va de 0 a 10' })
  .refine(isOneDecimal, { message: 'Usa máximo un decimal' });

/**
 * One grade of the batch. SCORED needs a score; NOT_DELIVERED is stored as 0 and EXCUSED as
 * null, whatever score was sent. `expectedUpdatedAt` is the version the client last saw
 * (null = "there was no grade"); omit it to overwrite without checking.
 */
export const gradeEntrySchema = z
  .object({
    studentId: objectIdSchema,
    status: z.enum(GRADE_STATUSES),
    score: scoreSchema.nullable().optional(),
    comment: z.string().trim().max(300).nullable().optional(),
    expectedUpdatedAt: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((g, ctx) => {
    if (g.status === 'SCORED' && (g.score === null || g.score === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['score'], message: 'Escribe la calificación' });
    }
  })
  .transform((g) => ({
    ...g,
    score: g.status === 'NOT_DELIVERED' ? 0 : g.status === 'EXCUSED' ? null : (g.score as number),
    comment: g.comment || null,
  }));
export type GradeEntryInput = z.input<typeof gradeEntrySchema>;
export type GradeEntry = z.output<typeof gradeEntrySchema>;

export const saveGradesSchema = z.object({
  grades: z
    .array(gradeEntrySchema)
    .min(1, { message: 'No hay calificaciones que guardar' })
    .max(100)
    .refine((list) => new Set(list.map((g) => g.studentId)).size === list.length, {
      message: 'Un alumno aparece dos veces en el lote',
    }),
});
export type SaveGradesInput = z.input<typeof saveGradesSchema>;

export interface GradeValue {
  status: GradeStatus;
  score: number | null;
  comment: string | null;
  updatedAt: string;
}

export interface GradeRow {
  student: {
    id: string;
    listNumber: number;
    fullName: string;
    /** First given name + paternal surname ("Edgar Aguilar"). */
    shortName: string;
  };
  grade: GradeValue | null;
}

export interface ActivityGradesView {
  activity: ActivityView;
  groupName: string;
  periodStatus: string;
  rows: GradeRow[];
}

export interface SaveGradesResult {
  saved: (GradeValue & { studentId: string })[];
}

/** `details` of a 409 GRADE_CONFLICT: what is stored now for each conflicting student. */
export interface GradeConflict {
  studentId: string;
  current: GradeValue | null;
}

export interface StudentGradesView {
  student: { id: string; fullName: string; listNumber: number; groupId: string; groupName: string };
  periodId: string;
  fields: {
    fieldKey: FieldKey;
    activities: {
      id: string;
      name: string;
      component: Component;
      subjectKey?: SubjectKey;
      date: string;
      grade: GradeValue | null;
    }[];
  }[];
}

export function shortStudentName(s: { firstName: string; lastName1: string }): string {
  const first = s.firstName.trim().split(/\s+/)[0] ?? '';
  return `${first} ${s.lastName1}`.trim();
}

// ---------------------------------------------------------------------------
// Student notes
// ---------------------------------------------------------------------------
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  ACADEMICO: 'Académico',
  CONDUCTA: 'Conducta',
  RECONOCIMIENTO: 'Reconocimiento',
  SALUD: 'Salud',
  OTRO: 'Otro',
};

/** Section 7: SALUD notes are never visible to guardians, whatever was requested. */
export function normalizeNoteVisibility(kind: NoteKind, requested: boolean): boolean {
  return kind === 'SALUD' ? false : requested;
}

/** Single rule used by every guardian-facing read (stage 5). */
export function isNoteVisibleToGuardians(note: { kind: NoteKind; visibleToGuardians: boolean }) {
  return note.kind !== 'SALUD' && note.visibleToGuardians;
}

const noteText = z
  .string({ message: 'Escribe la nota' })
  .trim()
  .min(1, { message: 'Escribe la nota' })
  .max(2000, { message: 'Máximo 2000 caracteres' });

export const createNoteSchema = z.object({
  kind: z.enum(NOTE_KINDS, { message: 'Elige el tipo de nota' }),
  text: noteText,
  fieldKey: z.enum(FIELD_KEYS).optional(),
  date: dateOnlySchema,
  visibleToGuardians: z.boolean().default(false),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    kind: z.enum(NOTE_KINDS),
    text: noteText,
    fieldKey: z.enum(FIELD_KEYS).nullable(),
    date: dateOnlySchema,
    visibleToGuardians: z.boolean(),
  })
  .partial();
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

export const groupNotesQuerySchema = z.object({ date: dateOnlySchema });
export const studentNotesQuerySchema = z.object({ periodId: objectIdSchema.optional() });

export interface NoteView {
  id: string;
  student: { id: string; shortName: string; listNumber?: number };
  groupId: string;
  periodId: string;
  author: { id: string; name: string };
  date: string;
  fieldKey?: FieldKey;
  kind: NoteKind;
  text: string;
  visibleToGuardians: boolean;
  /** The current user may edit or delete it (their own note, or admin). */
  canEdit: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export const AUDIT_ENTITIES = ['grade', 'activity', 'note'] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const auditQuerySchema = paginationQuerySchema.extend({
  entity: z.enum(AUDIT_ENTITIES).optional(),
  entityId: objectIdSchema.optional(),
  groupId: objectIdSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditLogView {
  id: string;
  actor: { id: string; name: string };
  action: 'create' | 'update' | 'delete';
  entity: AuditEntity;
  entityId: string;
  groupId?: string;
  before: unknown;
  after: unknown;
  at: string;
}
