import { z } from 'zod';
import type { Component, FieldKey, GradeStatus, NoteKind, PeriodStatus } from '../enums';
import { emailSchema, objectIdSchema, passwordSchema, personNameSchema } from './common';

// ---------------------------------------------------------------------------
// Guardian codes (section 7: 8 characters, single use, 14 days)
// ---------------------------------------------------------------------------
/** No 0/O/1/I, so the code can be dictated and copied from paper without mistakes. */
export const GUARDIAN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GUARDIAN_CODE_LENGTH = 8;
export const GUARDIAN_CODE_TTL_DAYS = 14;
/** A student can be linked to at most 4 guardians. */
export const MAX_GUARDIANS_PER_STUDENT = 4;

/** "abcd-2345 " → "ABCD2345" (spaces and dashes are ignored). */
export function normalizeGuardianCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

/** Shown as "ABCD-2345" so it is easier to read aloud. */
export function formatGuardianCode(code: string): string {
  const clean = normalizeGuardianCode(code);
  return clean.length === GUARDIAN_CODE_LENGTH ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export const guardianCodeSchema = z
  .string({ message: 'Escribe el código' })
  .transform(normalizeGuardianCode)
  .pipe(
    z
      .string()
      .length(GUARDIAN_CODE_LENGTH, { message: 'El código tiene 8 caracteres' })
      .regex(new RegExp(`^[${GUARDIAN_CODE_ALPHABET}]+$`), {
        message: 'El código no es válido. Revisa que esté bien escrito.',
      }),
  );

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

export const createGuardianInvitationSchema = z.object({
  studentId: objectIdSchema,
  relationship: relationshipSchema.optional(),
});
export type CreateGuardianInvitationInput = z.infer<typeof createGuardianInvitationSchema>;

export interface GuardianInvitationView {
  id: string;
  /** Plain code: shown only once, when it is generated (the API stores only its hash). */
  code: string;
  expiresAt: string;
  student: { id: string; fullName: string; shortName: string };
  groupName: string;
  /** Link to sign up with the code already filled in. */
  url: string;
}

export const printGuardianCodesSchema = z.object({
  /** Students to print codes for; empty = every student without a linked guardian. */
  studentIds: z.array(objectIdSchema).max(60).optional(),
});
export type PrintGuardianCodesInput = z.infer<typeof printGuardianCodesSchema>;

export type GuardianLinkStatus = 'NONE' | 'PENDING' | 'LINKED';

export interface GuardianLinkView {
  id: string;
  guardian: { id: string; name: string; email: string };
  relationship: Relationship;
  linkedAt: string;
}

/** One row of "Padres de familia" (never includes codes). */
export interface GroupGuardianRow {
  student: { id: string; listNumber: number; fullName: string; shortName: string };
  status: GuardianLinkStatus;
  links: GuardianLinkView[];
  pendingCodes: number;
  /** Latest expiration among the pending codes. */
  pendingExpiresAt: string | null;
}

// ---------------------------------------------------------------------------
// Redeeming a code
// ---------------------------------------------------------------------------
export const guardianCodePreviewSchema = z.object({ code: guardianCodeSchema });

export interface GuardianCodePreview {
  /** "Aguilar C. Edgar M." — enough to recognize the child, not the full name. */
  studentName: string;
  groupName: string;
  schoolName: string;
  expiresAt: string;
}

const acceptPrivacy = z.literal(true, {
  message: 'Para continuar acepta el aviso de privacidad',
});

export const registerGuardianSchema = z.object({
  code: guardianCodeSchema,
  firstName: personNameSchema,
  lastName: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  relationship: relationshipSchema,
  acceptPrivacy,
});
export type RegisterGuardianInput = z.infer<typeof registerGuardianSchema>;

/** A signed-in guardian adds another child ("Agregar hijo"). */
export const redeemGuardianCodeSchema = z.object({
  code: guardianCodeSchema,
  relationship: relationshipSchema,
  /** Required when the user has not accepted the current privacy notice yet. */
  acceptPrivacy: z.boolean().optional(),
});
export type RedeemGuardianCodeInput = z.infer<typeof redeemGuardianCodeSchema>;

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

/** "Aguilar C. Edgar M.": first surname, initials of the rest. Shown before linking. */
export function maskedStudentName(s: {
  firstName: string;
  lastName1: string;
  lastName2?: string | null;
}): string {
  const initial = (word: string) => `${word.charAt(0).toUpperCase()}.`;
  const [first = '', ...rest] = s.firstName.trim().split(/\s+/);
  return [
    s.lastName1.trim(),
    s.lastName2?.trim() ? initial(s.lastName2.trim()) : '',
    first,
    ...rest.map(initial),
  ]
    .filter(Boolean)
    .join(' ');
}
