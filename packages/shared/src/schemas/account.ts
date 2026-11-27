import { z } from 'zod';
import { type Role, STAFF_ROLES } from '../enums';
import { emailSchema, passwordSchema, personNameSchema } from './common';
import { relationshipSchema } from './guardian';
import type { User } from './user';

// ---------------------------------------------------------------------------
// Usernames: type + 2-digit year + consecutive ("MAE26-0001")
// ---------------------------------------------------------------------------
export const USERNAME_PREFIXES: Record<Role, string> = {
  ADMIN: 'ADM',
  DIRECTOR: 'DIR',
  TEACHER: 'MAE',
  GUARDIAN: 'TUT',
};
const PREFIX_PRIORITY: Role[] = ['ADMIN', 'DIRECTOR', 'TEACHER', 'GUARDIAN'];
export const USERNAME_REGEX = /^(ADM|DIR|MAE|TUT)\d{2}-\d{4}$/;

/** Prefix of the account's main role (a director who also teaches is DIR). */
export function usernamePrefixFor(roles: readonly Role[]): string {
  const role = PREFIX_PRIORITY.find((r) => roles.includes(r)) ?? 'GUARDIAN';
  return USERNAME_PREFIXES[role];
}

/** "MAE26-0007". */
export function formatUsername(prefix: string, year: number, sequence: number): string {
  return `${prefix}${String(year % 100).padStart(2, '0')}-${String(sequence).padStart(4, '0')}`;
}

/** Users type the username in any case and with spaces: " mae26-0007" → "MAE26-0007". */
export function normalizeLoginId(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed.toUpperCase().replace(/\s+/g, '');
}

/** Login with the username (or, for older accounts, the email). */
export const loginIdSchema = z
  .string({ message: 'Escribe tu usuario' })
  .min(1, { message: 'Escribe tu usuario' })
  .max(120)
  .transform(normalizeLoginId);

// ---------------------------------------------------------------------------
// Phone (identifies a guardian across the school) and temporary passwords
// ---------------------------------------------------------------------------
/** Mexican phone: the last 10 digits (ignores spaces, dashes and +52). */
export function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

export const phoneSchema = z
  .string({ message: 'Escribe el teléfono' })
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\d{10}$/, { message: 'El teléfono debe tener 10 dígitos' }));

/** "55 1234 5678". */
export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  return digits.length === 10
    ? `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`
    : phone;
}

/** Temporary password alphabet: no 0/O/1/I/L so it can be dictated or copied from paper. */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const optionalEmail = z
  .union([emailSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Máximo ${max} caracteres` })
    .optional()
    .nullable()
    .transform((value) => (value ? value : null));
const optionalPhone = z
  .union([phoneSchema, z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

// ---------------------------------------------------------------------------
// My profile
// ---------------------------------------------------------------------------
export const updateProfileSchema = z.object({
  firstName: personNameSchema,
  lastName: z.string().trim().max(80),
  email: optionalEmail,
  phone: optionalPhone,
  address: optionalText(200),
});
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type UpdateProfileData = z.output<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: 'Escribe tu contraseña actual' }).max(128),
  newPassword: passwordSchema,
  /** Guardians accept the privacy notice the first time they sign in. */
  acceptPrivacy: z.boolean().optional(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ---------------------------------------------------------------------------
// Accounts created by the school (staff and guardians)
// ---------------------------------------------------------------------------
export const createStaffSchema = z.object({
  firstName: personNameSchema,
  lastName: z.string().trim().max(80).default(''),
  roles: z
    .array(z.enum(STAFF_ROLES))
    .min(1, { message: 'Elige al menos un rol' })
    .transform((roles) => [...new Set(roles)]),
  email: optionalEmail,
  phone: optionalPhone,
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;
export type CreateStaffData = z.output<typeof createStaffSchema>;

export const createGuardianSchema = z.object({
  firstName: personNameSchema,
  lastName: personNameSchema,
  phone: phoneSchema,
  relationship: relationshipSchema,
  address: optionalText(200),
  email: optionalEmail,
});
export type CreateGuardianInput = z.input<typeof createGuardianSchema>;
export type CreateGuardianData = z.output<typeof createGuardianSchema>;

/** Result of creating an account: the temporary password is shown only this once. */
export interface CreatedAccountView {
  user: User;
  username: string;
  /** null when the person already had an account (a guardian found by phone). */
  temporaryPassword: string | null;
  /** The guardian already existed (same phone): the student was added to that account. */
  existing: boolean;
  /** Children linked to the guardian after the operation. */
  children?: { id: string; fullName: string; groupName: string }[];
}

export interface TemporaryPasswordView {
  username: string;
  temporaryPassword: string;
}
