import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  createStaffInvitationSchema,
  loginSchema,
  resetPasswordSchema,
} from '../src/schemas/auth';
import {
  createGuardianSchema,
  formatUsername,
  loginIdSchema,
  normalizePhone,
  phoneSchema,
  USERNAME_REGEX,
  usernamePrefixFor,
} from '../src/schemas/account';
import { FIELD_COLORS, PRIMARY_COLOR } from '../src/theme';

describe('auth schemas', () => {
  it('normalizes the username on login', () => {
    const parsed = loginSchema.parse({ username: '  mae26-0001 ', password: 'x' });
    expect(parsed.username).toBe('MAE26-0001');
  });

  it('asks for the username with a Spanish message', () => {
    const result = loginSchema.safeParse({ username: '', password: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Escribe tu usuario');
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

describe('usernames, phones and guardian accounts', () => {
  it('builds usernames as type + 2-digit year + consecutive', () => {
    expect(formatUsername(usernamePrefixFor(['TEACHER']), 2026, 1)).toBe('MAE26-0001');
    expect(formatUsername(usernamePrefixFor(['GUARDIAN']), 2026, 153)).toBe('TUT26-0153');
    expect(usernamePrefixFor(['TEACHER', 'DIRECTOR'])).toBe('DIR');
    expect(usernamePrefixFor(['ADMIN', 'TEACHER'])).toBe('ADM');
    expect(USERNAME_REGEX.test('MAE26-0001')).toBe(true);
    expect(USERNAME_REGEX.test('MAE2026-001')).toBe(false);
  });

  it('accepts the username in any case (or an email for older accounts)', () => {
    expect(loginIdSchema.parse(' mae26-0007 ')).toBe('MAE26-0007');
    expect(loginIdSchema.parse(' Viry@Escuela.MX ')).toBe('viry@escuela.mx');
  });

  it('normalizes Mexican phones to 10 digits', () => {
    expect(normalizePhone('+52 (312) 123-4567')).toBe('3121234567');
    expect(phoneSchema.parse('312 123 4567')).toBe('3121234567');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
  });

  it('a guardian needs name, phone and relationship; email and address are optional', () => {
    const parsed = createGuardianSchema.parse({
      firstName: 'Laura',
      lastName: 'Pérez',
      phone: '312-123-4567',
      relationship: 'MADRE',
      email: '',
    });
    expect(parsed).toMatchObject({ phone: '3121234567', email: null, address: null });
    expect(
      createGuardianSchema.safeParse({ firstName: 'L', lastName: 'P', relationship: 'MADRE' })
        .success,
    ).toBe(false);
  });
});
