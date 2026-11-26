import { z } from 'zod';
import { STAFF_ROLES } from '../enums';
import { emailSchema, passwordSchema, personNameSchema } from './common';
import { userSchema } from './user';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Escribe tu contraseña' }).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20, { message: 'El enlace no es válido' }).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = z.object({
  code: z.string().min(20, { message: 'La invitación no es válida' }).max(200),
  firstName: personNameSchema,
  lastName: personNameSchema,
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const createStaffInvitationSchema = z.object({
  email: emailSchema,
  roles: z
    .array(z.enum(STAFF_ROLES))
    .min(1, { message: 'Elige al menos un rol' })
    .transform((roles) => [...new Set(roles)]),
});
export type CreateStaffInvitationInput = z.infer<typeof createStaffInvitationSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  user: userSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Claims stored in the access JWT. Only ids, never personal data. */
export interface AccessTokenPayload {
  sub: string;
  sid: string;
  schoolId: string;
  roles: string[];
}
