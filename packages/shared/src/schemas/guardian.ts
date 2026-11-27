import { z } from 'zod';
import type { Component, FieldKey, GradeStatus, NoteKind, PeriodStatus } from '../enums';

// ---------------------------------------------------------------------------
// Guardians: accounts created by the teacher or the direction from the students
// ---------------------------------------------------------------------------
/** A student can be linked to at most 4 guardians. */
export const MAX_GUARDIANS_PER_STUDENT = 4;

export const RELATIONSHIPS = ['MADRE', 'PADRE', 'TUTOR', 'ABUELO', 'OTRO'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  MADRE: 'Mamá',
  PADRE: 'Papá',
  TUTOR: 'Tutor(a)',
  ABUELO: 'Abuelo(a)',
  OTRO: 'Otro familiar',
};
export const relationshipSchema = z.enum(RELATIONSHIPS, { message: 'Elige el parentesco' });

export type GuardianLinkStatus = 'NONE' | 'LINKED';

export interface GuardianLinkView {
  id: string;
  guardian: {
    id: string;
    name: string;
    username: string;
    phone: string | null;
    email: string | null;
    /** Has signed in and chosen their own password. */
    activated: boolean;
  };
  relationship: Relationship;
  linkedAt: string;
}

/** One row of "Padres de familia" of a group. */
export interface GroupGuardianRow {
  student: { id: string; listNumber: number; fullName: string; shortName: string };
  status: GuardianLinkStatus;
  links: GuardianLinkView[];
}

// ---------------------------------------------------------------------------
// Privacy notice (section 7)
// ---------------------------------------------------------------------------
export const PRIVACY_PENDING_REVIEW = 'PENDIENTE DE REVISIÓN POR LA DIRECCIÓN';

export const updatePrivacyNoticeSchema = z.object({
  text: z
    .string()
    .trim()
    .min(50, { message: 'El aviso es demasiado corto' })
    .max(20_000, { message: 'Máximo 20,000 caracteres' }),
});
export type UpdatePrivacyNoticeInput = z.infer<typeof updatePrivacyNoticeSchema>;

export interface PrivacyNoticeView {
  schoolName: string;
  text: string;
  version: number;
  updatedAt: string | null;
  /** Still the template: shows the "pending review" banner. */
  pendingReview: boolean;
}

// ---------------------------------------------------------------------------
// Guardian portal (/me/children)
// ---------------------------------------------------------------------------
export interface ChildPeriod {
  id: string;
  number: number;
  name: string;
  status: PeriodStatus;
  /** The period that contains today (or the latest one that started). */
  current: boolean;
}

export interface ChildView {
  id: string;
  firstName: string;
  shortName: string;
  fullName: string;
  relationship: Relationship;
  group: { id: string; name: string };
  teacher: string | null;
  schoolYear: string;
  periods: ChildPeriod[];
}

export interface ChildFieldProgress {
  fieldKey: FieldKey;
  name: string;
  shortName: string;
  color: string;
  /** Current average of the visible grades (1 decimal), null without grades yet. */
  average: number | null;
  needsSupport: boolean;
}

export interface ChildOverview {
  period: { id: string; name: string; status: PeriodStatus };
  fields: ChildFieldProgress[];
  /** "Necesita apoyo en Saberes y Ética." or null. */
  supportMessage: string | null;
  /** Cumulative average per field at the end of each week (only weeks with grades). */
  weekly: { week: string; values: Partial<Record<FieldKey, number>> }[];
}

export interface ChildActivity {
  id: string;
  name: string;
  fieldKey: FieldKey;
  component: Component;
  date: string;
  grade: { status: GradeStatus; score: number | null } | null;
}

export interface ChildNote {
  id: string;
  date: string;
  kind: NoteKind;
  fieldKey?: FieldKey;
  text: string;
  author: string;
}

export interface ChildReportCard {
  period: { id: string; name: string; number: number };
  publishedAt: string | null;
  fields: { fieldKey: FieldKey; name: string; final: number | null; adjusted: boolean }[];
  generalAverage: number | null;
}

/** Template shown until the school's direction reviews and edits it. */
export function defaultPrivacyNotice(schoolName: string): string {
  return [
    `${PRIVACY_PENDING_REVIEW}`,
    '',
    `Aviso de privacidad simplificado de ${schoolName}.`,
    '',
    'Responsable. La escuela es responsable del tratamiento de los datos personales que se registran en este sistema de evaluación.',
    '',
    'Datos que se tratan. Nombre del alumno, grupo, número de lista, actividades escolares, calificaciones y observaciones del maestro. Del padre, madre o tutor: nombre, correo electrónico y parentesco. La CURP y la fecha de nacimiento del alumno son opcionales.',
    '',
    'Finalidad. Registrar y consultar la evaluación formativa del alumno, generar sus boletas y permitir que su familia consulte su avance. Los datos no se usan con fines comerciales ni se comparten con terceros, salvo obligación legal.',
    '',
    'Acceso. Cada persona ve solo lo que le corresponde: el maestro, sus grupos; la dirección, su escuela; cada familia, solo a sus hijos. Las notas de salud nunca se muestran a las familias desde el sistema.',
    '',
    'Derechos ARCO. Para acceder, rectificar, cancelar u oponerse al tratamiento de sus datos, acuda a la dirección de la escuela.',
    '',
    'Cambios. Cualquier cambio a este aviso se publicará en esta misma página.',
  ].join('\n');
}
