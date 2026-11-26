/**
 * Enums from section 4 of docs/plan.md. Values are stored as-is in MongoDB,
 * so never rename a value without a migration.
 */
function enumValues<T extends Record<string, string>>(obj: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(obj) as [T[keyof T], ...T[keyof T][]];
}

export const Role = {
  ADMIN: 'ADMIN',
  DIRECTOR: 'DIRECTOR',
  TEACHER: 'TEACHER',
  GUARDIAN: 'GUARDIAN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = enumValues(Role);

/** Roles that can be granted through a staff invitation (guardians use codes). */
export const STAFF_ROLES = [Role.ADMIN, Role.DIRECTOR, Role.TEACHER] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const UserStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = enumValues(UserStatus);

export const PeriodStatus = {
  OPEN: 'OPEN',
  IN_REVIEW: 'IN_REVIEW',
  CLOSED: 'CLOSED',
  PUBLISHED: 'PUBLISHED',
} as const;
export type PeriodStatus = (typeof PeriodStatus)[keyof typeof PeriodStatus];
export const PERIOD_STATUSES = enumValues(PeriodStatus);

export const EnrollmentStatus = {
  ACTIVE: 'ACTIVE',
  TRANSFERRED: 'TRANSFERRED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type EnrollmentStatus = (typeof EnrollmentStatus)[keyof typeof EnrollmentStatus];
export const ENROLLMENT_STATUSES = enumValues(EnrollmentStatus);

export const AssignmentScope = {
  HOMEROOM: 'HOMEROOM',
  SUBJECT: 'SUBJECT',
} as const;
export type AssignmentScope = (typeof AssignmentScope)[keyof typeof AssignmentScope];
export const ASSIGNMENT_SCOPES = enumValues(AssignmentScope);

export const SubjectKey = {
  INGLES: 'ingles',
  ED_FISICA: 'ed_fisica',
} as const;
export type SubjectKey = (typeof SubjectKey)[keyof typeof SubjectKey];
export const SUBJECT_KEYS = enumValues(SubjectKey);

export const InvitationType = {
  STAFF: 'STAFF',
  GUARDIAN: 'GUARDIAN',
} as const;
export type InvitationType = (typeof InvitationType)[keyof typeof InvitationType];
export const INVITATION_TYPES = enumValues(InvitationType);

export const FieldKey = {
  LENGUAJES: 'lenguajes',
  SABERES: 'saberes',
  ETICA: 'etica',
  HUMANO: 'humano',
} as const;
export type FieldKey = (typeof FieldKey)[keyof typeof FieldKey];
export const FIELD_KEYS = enumValues(FieldKey);

export const Component = {
  DESEMPENO: 'DESEMPENO',
  PROYECTO: 'PROYECTO',
  EXAMEN: 'EXAMEN',
  COMPLEMENTARIA: 'COMPLEMENTARIA',
} as const;
export type Component = (typeof Component)[keyof typeof Component];
export const COMPONENTS = enumValues(Component);

export const GradeStatus = {
  SCORED: 'SCORED',
  NOT_DELIVERED: 'NOT_DELIVERED',
  EXCUSED: 'EXCUSED',
} as const;
export type GradeStatus = (typeof GradeStatus)[keyof typeof GradeStatus];
export const GRADE_STATUSES = enumValues(GradeStatus);

export const NoteKind = {
  ACADEMICO: 'ACADEMICO',
  CONDUCTA: 'CONDUCTA',
  RECONOCIMIENTO: 'RECONOCIMIENTO',
  SALUD: 'SALUD',
  OTRO: 'OTRO',
} as const;
export type NoteKind = (typeof NoteKind)[keyof typeof NoteKind];
export const NOTE_KINDS = enumValues(NoteKind);

export const GrantScopeType = {
  SCHOOL: 'SCHOOL',
  GROUP: 'GROUP',
} as const;
export type GrantScopeType = (typeof GrantScopeType)[keyof typeof GrantScopeType];
export const GRANT_SCOPE_TYPES = enumValues(GrantScopeType);
