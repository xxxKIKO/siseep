import { z } from 'zod';
import { ROLES, USER_STATUSES, type Role } from '../enums';
import { emailSchema, objectIdSchema } from './common';

export const roleSchema = z.enum(ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

/** Public shape of a user returned by the API (never includes the password hash). */
export const userSchema = z.object({
  id: objectIdSchema,
  schoolId: objectIdSchema,
  /** Login: type + year + consecutive ("MAE26-0001"). */
  username: z.string(),
  email: emailSchema.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  /** Has a profile photo (GET /me/photo). */
  hasPhoto: z.boolean().optional(),
  /** Created with a temporary password: must choose their own before anything else. */
  mustChangePassword: z.boolean().optional(),
  roles: z.array(roleSchema).min(1),
  status: userStatusSchema,
  lastLoginAt: z.string().nullable().optional(),
  /** Has a logo for the report cards (teachers). */
  hasLogo: z.boolean().optional(),
  /** Version of the privacy notice the user accepted (guardians). */
  privacyAcceptedVersion: z.number().int().nullable().optional(),
});
export type User = z.infer<typeof userSchema>;

/** Minimal identity used to build CASL abilities (from the JWT or the DB). */
export interface AuthUser {
  id: string;
  schoolId: string;
  roles: readonly Role[];
}
