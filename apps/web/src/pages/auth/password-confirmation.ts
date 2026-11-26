import { passwordSchema } from '@siseep/shared';
import { z } from 'zod';

/** New password typed twice. */
export const newPasswordFields = {
  password: passwordSchema,
  confirmPassword: z.string().min(1, { message: 'Vuelve a escribir la contraseña' }),
};

export function passwordsMatch(values: { password: string; confirmPassword: string }): boolean {
  return values.password === values.confirmPassword;
}

export const PASSWORD_MISMATCH = {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
};
