import { z } from 'zod';
import { ROLES, USER_STATUSES, type Role } from '../enums';
import { emailSchema, objectIdSchema } from './common';

export const roleSchema = z.enum(ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

/** Public shape of a user returned by the API (never includes the password hash). */
export const userSchema = z.object({
  id: objectIdSchema,
  schoolId: objectIdSchema,
  email: emailSchema,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string().optional(),
  roles: z.array(roleSchema).min(1),
  status: userStatusSchema,
  lastLoginAt: z.string().nullable().optional(),
  /** Has a logo for the report cards (teachers). */
  hasLogo: z.boolean().optional(),
});
export type User = z.infer<typeof userSchema>;

/** Minimal identity used to build CASL abilities (from the JWT or the DB). */
export interface AuthUser {
  id: string;
  schoolId: string;
  roles: readonly Role[];
}
