import { z } from 'zod';
import { DATE_ONLY_REGEX } from '../dates';
import {
  ASSIGNMENT_SCOPES,
  COMPONENTS,
  ENROLLMENT_STATUSES,
  FIELD_KEYS,
  GRANT_SCOPE_TYPES,
  GRADE_STATUSES,
  PERIOD_STATUSES,
  ROLES,
  STAFF_ROLES,
  SUBJECT_KEYS,
  USER_STATUSES,
} from '../enums';
import { objectIdSchema, personNameSchema } from './common';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
export const dateOnlySchema = z
  .string({ message: 'Escribe una fecha' })
  .regex(DATE_ONLY_REGEX, { message: 'Fecha inválida (AAAA-MM-DD)' });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Máximo ${max} caracteres` })
    .optional();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// School
// ---------------------------------------------------------------------------
export const updateSchoolSchema = z
  .object({
    name: z.string().trim().min(3, { message: 'Escribe el nombre de la escuela' }).max(150),
    shortName: optionalText(60),
    cct: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9A-Z]{10}$/, { message: 'La CCT tiene 10 caracteres (ej. 06DPR0001X)' })
      .optional()
      .or(z.literal('')),
    city: optionalText(80),
    state: optionalText(80),
  })
  .partial();
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;

export interface SchoolView {
  id: string;
  name: string;
  shortName?: string;
  cct?: string;
  city?: string;
  state?: string;
  hasLogo: boolean;
}

export const LOGO_MAX_BYTES = 1024 * 1024;
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg'] as const;

// ---------------------------------------------------------------------------
// School years and periods
// ---------------------------------------------------------------------------
const dateRange = <T extends { startDate?: string; endDate?: string }>(value: T) =>
  !value.startDate || !value.endDate || value.startDate <= value.endDate;
const DATE_RANGE_ERROR = {
  message: 'La fecha de inicio debe ser anterior a la de fin',
  path: ['endDate'],
};

export const createSchoolYearSchema = z
  .object({
    name: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{4}$/, { message: 'Usa el formato 2026-2027' }),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    isCurrent: z.boolean().default(false),
  })
  .refine(dateRange, DATE_RANGE_ERROR);
export type CreateSchoolYearInput = z.infer<typeof createSchoolYearSchema>;

export const updateSchoolYearSchema = z
  .object({
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    isCurrent: z.boolean(),
  })
  .partial()
  .refine(dateRange, DATE_RANGE_ERROR);
export type UpdateSchoolYearInput = z.infer<typeof updateSchoolYearSchema>;

export interface SchoolYearView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export const createPeriodSchema = z
  .object({
    schoolYearId: objectIdSchema,
    number: z.number().int().min(1).max(3),
    name: z.string().trim().min(1).max(60),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    deliveryDate: dateOnlySchema.optional(),
    deliveryDateText: optionalText(120),
  })
  .refine(dateRange, DATE_RANGE_ERROR);
export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;

/** Stage 1: only names and dates. Status changes come with period closing (stage 4). */
export const updatePeriodSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    deliveryDate: dateOnlySchema.nullable(),
    deliveryDateText: z.string().trim().max(120).nullable(),
  })
  .partial()
  .refine(dateRange, DATE_RANGE_ERROR);
export type UpdatePeriodInput = z.infer<typeof updatePeriodSchema>;

export interface PeriodView {
  id: string;
  schoolYearId: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  status: (typeof PERIOD_STATUSES)[number];
  deliveryDate?: string;
  deliveryDateText?: string;
}

// ---------------------------------------------------------------------------
// Groups and teaching assignments
// ---------------------------------------------------------------------------
export const createGroupSchema = z.object({
  schoolYearId: objectIdSchema,
  grade: z.number().int().min(1).max(6),
  letter: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]$/, { message: 'Una sola letra (A-Z)' }),
  homeroomTeacherId: objectIdSchema.optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  homeroomTeacherId: objectIdSchema.nullable(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const createAssignmentSchema = z
  .object({
    teacherId: objectIdSchema,
    scope: z.enum(ASSIGNMENT_SCOPES),
    subjectKey: z.enum(SUBJECT_KEYS).optional(),
  })
  .refine((a) => (a.scope === 'SUBJECT') === Boolean(a.subjectKey), {
    message: 'Elige la materia solo para maestros de materia',
    path: ['subjectKey'],
  });
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

export interface TeacherSummary {
  id: string;
  name: string;
  email: string;
}

export interface AssignmentView {
  id: string;
  groupId: string;
  teacher: TeacherSummary;
  scope: (typeof ASSIGNMENT_SCOPES)[number];
  subjectKey?: (typeof SUBJECT_KEYS)[number];
}

export interface GroupView {
  id: string;
  schoolYearId: string;
  schoolYearName: string;
  grade: number;
  letter: string;
  name: string;
  homeroomTeacher?: TeacherSummary;
  studentCount: number;
  currentPeriod?: { id: string; number: number; name: string; status: string };
  assignments: AssignmentView[];
}

// ---------------------------------------------------------------------------
// Students and enrollments
// ---------------------------------------------------------------------------
const curpSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}\d{6}[HMX][A-Z]{5}[0-9A-Z]\d$/, { message: 'CURP inválida' });

export const createStudentSchema = z.object({
  firstName: personNameSchema,
  lastName1: personNameSchema,
  lastName2: z.string().trim().max(80).default(''),
  curp: curpSchema.optional().or(z.literal('')),
  birthDate: dateOnlySchema.optional().or(z.literal('')),
  notes: optionalText(500),
});
export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema.partial();
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const studentListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  groupId: objectIdSchema.optional(),
});
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;

export interface StudentView {
  id: string;
  firstName: string;
  lastName1: string;
  lastName2: string;
  fullName: string;
  curp?: string;
  birthDate?: string;
  notes?: string;
  enrollment?: {
    id: string;
    groupId: string;
    groupName: string;
    listNumber: number;
    status: string;
  };
}

export const createEnrollmentSchema = z.object({
  studentId: objectIdSchema,
  groupId: objectIdSchema,
  listNumber: z.number().int().min(1).max(99),
});
export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;

export const updateEnrollmentSchema = z
  .object({
    listNumber: z.number().int().min(1).max(99),
    status: z.enum(ENROLLMENT_STATUSES),
  })
  .partial();
export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;

export interface RosterEntry {
  enrollmentId: string;
  listNumber: number;
  status: (typeof ENROLLMENT_STATUSES)[number];
  student: {
    id: string;
    firstName: string;
    lastName1: string;
    lastName2: string;
    fullName: string;
  };
}

// ---------------------------------------------------------------------------
// Users and permission grants (admin)
// ---------------------------------------------------------------------------
export const updateUserSchema = z
  .object({
    firstName: personNameSchema,
    lastName: z.string().trim().max(80),
    roles: z
      .array(z.enum(ROLES))
      .min(1, { message: 'Elige al menos un rol' })
      .transform((roles) => [...new Set(roles)]),
  })
  .partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

export { STAFF_ROLES };

/** Actions an admin can grant (section 2). Format `<resource>:<verb>`. */
export const GRANTABLE_ACTIONS = [
  'activity:create',
  'activity:update',
  'grade:update',
  'note:create',
  'note:update',
  'periodResult:update',
  'period:update',
] as const;
export type GrantableAction = (typeof GRANTABLE_ACTIONS)[number];

export const GRANTABLE_ACTION_LABELS: Record<GrantableAction, string> = {
  'activity:create': 'Crear actividades',
  'activity:update': 'Editar actividades',
  'grade:update': 'Editar calificaciones',
  'note:create': 'Escribir notas de alumnos',
  'note:update': 'Editar notas de alumnos',
  'periodResult:update': 'Ajustes y observaciones de periodo',
  'period:update': 'Cerrar y publicar periodos',
};

export const createPermissionGrantSchema = z
  .object({
    userId: objectIdSchema,
    action: z.enum(GRANTABLE_ACTIONS),
    scope: z.object({
      type: z.enum(GRANT_SCOPE_TYPES),
      groupId: objectIdSchema.optional(),
    }),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((g) => (g.scope.type === 'GROUP') === Boolean(g.scope.groupId), {
    message: 'Elige el grupo solo cuando el alcance es un grupo',
    path: ['scope', 'groupId'],
  })
  .refine((g) => !g.expiresAt || new Date(g.expiresAt).getTime() > Date.now(), {
    message: 'La fecha de vencimiento debe ser futura',
    path: ['expiresAt'],
  });
export type CreatePermissionGrantInput = z.infer<typeof createPermissionGrantSchema>;

export interface PermissionGrantView {
  id: string;
  user: TeacherSummary;
  action: string;
  scope: { type: (typeof GRANT_SCOPE_TYPES)[number]; groupId?: string; groupName?: string };
  expiresAt?: string;
  active: boolean;
  grantedBy: TeacherSummary;
  reason?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Activities (stage 1: read and fix imported names/dates; capture is stage 2)
// ---------------------------------------------------------------------------
export const activityListQuerySchema = z.object({
  periodId: objectIdSchema,
  fieldKey: z.enum(FIELD_KEYS).optional(),
});
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

export const updateActivitySchema = z
  .object({
    name: z.string().trim().min(1, { message: 'Escribe el nombre' }).max(120),
    date: dateOnlySchema,
  })
  .partial();
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

export interface ActivityView {
  id: string;
  groupId: string;
  periodId: string;
  fieldKey: (typeof FIELD_KEYS)[number];
  component: (typeof COMPONENTS)[number];
  subjectKey?: (typeof SUBJECT_KEYS)[number];
  name: string;
  date: string;
  gradedCount: number;
}

export { GRADE_STATUSES };
