import { z } from 'zod';

/** 24-char hex MongoDB ObjectId as a string. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, { message: 'Identificador inválido' });

export const emailSchema = z
  .string({ message: 'Escribe tu correo' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Escribe un correo válido' }));

/** Section 7: minimum 10 characters. */
export const PASSWORD_MIN_LENGTH = 10;
export const passwordSchema = z
  .string({ message: 'Escribe una contraseña' })
  .min(PASSWORD_MIN_LENGTH, {
    message: 'La contraseña debe tener al menos ' + PASSWORD_MIN_LENGTH + ' caracteres',
  })
  .max(128, { message: 'La contraseña no puede tener más de 128 caracteres' });

export const personNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Este campo es obligatorio' })
  .max(80, { message: 'Máximo 80 caracteres' });
