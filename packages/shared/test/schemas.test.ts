import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  createStaffInvitationSchema,
  loginSchema,
  resetPasswordSchema,
} from '../src/schemas/auth';
import {
  formatGuardianCode,
  GUARDIAN_CODE_ALPHABET,
  guardianCodeSchema,
  maskedStudentName,
  registerGuardianSchema,
} from '../src/schemas/guardian';
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

describe('guardian codes', () => {
  it('normalizes and validates the 8-character code without ambiguous letters', () => {
    expect(guardianCodeSchema.parse(' abcd-2345 ')).toBe('ABCD2345');
    expect(formatGuardianCode('ABCD2345')).toBe('ABCD-2345');
    for (const bad of ['ABCD234', 'ABCD23450', 'ABCD0345', 'ABCDO345', 'ABCD1345', 'ABCDI345']) {
      expect(guardianCodeSchema.safeParse(bad).success).toBe(false);
    }
    expect(GUARDIAN_CODE_ALPHABET).not.toMatch(/[01OI]/);
  });

  it('masks the student name before linking', () => {
    expect(
      maskedStudentName({
        firstName: 'Edgar Mauricio',
        lastName1: 'Aguilar',
        lastName2: 'Contreras',
      }),
    ).toBe('Aguilar C. Edgar M.');
    expect(maskedStudentName({ firstName: 'Ana', lastName1: 'Ruiz' })).toBe('Ruiz Ana');
  });

  it('requires accepting the privacy notice to register', () => {
    const base = {
      code: 'ABCD2345',
      firstName: 'Laura',
      lastName: 'Pérez',
      email: 'laura@example.com',
      password: 'una-contraseña-larga',
      relationship: 'MADRE',
    };
    expect(registerGuardianSchema.safeParse({ ...base, acceptPrivacy: false }).success).toBe(false);
    expect(registerGuardianSchema.safeParse({ ...base, acceptPrivacy: true }).success).toBe(true);
  });
});
