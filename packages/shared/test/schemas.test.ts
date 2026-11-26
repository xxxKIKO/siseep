import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  createStaffInvitationSchema,
  loginSchema,
  resetPasswordSchema,
} from '../src/schemas/auth';
import { FIELD_COLORS, PRIMARY_COLOR } from '../src/theme';

describe('auth schemas', () => {
  it('normalizes the email on login', () => {
    const parsed = loginSchema.parse({ email: '  Viry@Escuela.MX ', password: 'x' });
    expect(parsed.email).toBe('viry@escuela.mx');
  });

  it('rejects an invalid email with a Spanish message', () => {
    const result = loginSchema.safeParse({ email: 'no-es-correo', password: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Escribe un correo válido');
  });

  it('requires passwords of at least 10 characters', () => {
    const token = 'a'.repeat(40);
    expect(resetPasswordSchema.safeParse({ token, password: '123456789' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token, password: '1234567890' }).success).toBe(true);
  });

  it('requires names when accepting an invitation', () => {
    const result = acceptInviteSchema.safeParse({
      code: 'a'.repeat(40),
      firstName: ' ',
      lastName: 'Pérez',
      password: 'contraseña-larga',
    });
    expect(result.success).toBe(false);
  });

  it('does not allow GUARDIAN in staff invitations and dedupes roles', () => {
    expect(
      createStaffInvitationSchema.safeParse({ email: 'a@b.mx', roles: ['GUARDIAN'] }).success,
    ).toBe(false);
    const parsed = createStaffInvitationSchema.parse({
      email: 'a@b.mx',
      roles: ['TEACHER', 'TEACHER', 'DIRECTOR'],
    });
    expect(parsed.roles).toEqual(['TEACHER', 'DIRECTOR']);
  });
});

describe('theme', () => {
  it('exposes the brand and field colors from the plan', () => {
    expect(PRIMARY_COLOR).toBe('#1F3A7A');
    expect(FIELD_COLORS).toEqual({
      lenguajes: '#F8CBAD',
      saberes: '#9BC2E6',
      etica: '#A9D08E',
      humano: '#B4A7D6',
    });
  });
});
