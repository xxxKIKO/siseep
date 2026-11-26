import { describe, expect, it } from 'vitest';
import { defaultRoleFor, resolveNextPath, roleFromPath, setPreferredRole } from './roles';

describe('roles helpers', () => {
  it('maps paths to portals', () => {
    expect(roleFromPath('/maestro')).toBe('TEACHER');
    expect(roleFromPath('/maestro/grupos/1')).toBe('TEACHER');
    expect(roleFromPath('/padres')).toBe('GUARDIAN');
    expect(roleFromPath('/maestros')).toBeNull();
    expect(roleFromPath('/cuenta')).toBeNull();
  });

  it('prefers the remembered role when the user still has it', () => {
    expect(defaultRoleFor(['TEACHER', 'DIRECTOR'])).toBe('DIRECTOR');
    setPreferredRole('TEACHER');
    expect(defaultRoleFor(['TEACHER', 'DIRECTOR'])).toBe('TEACHER');
    expect(defaultRoleFor(['GUARDIAN'])).toBe('GUARDIAN');
  });

  it('only follows ?siguiente= to pages the user can open', () => {
    expect(resolveNextPath('/maestro/grupos', ['TEACHER'])).toBe('/maestro/grupos');
    expect(resolveNextPath('/admin', ['TEACHER'])).toBe('/maestro');
    expect(resolveNextPath('//malicioso.com', ['TEACHER'])).toBe('/maestro');
    expect(resolveNextPath('https://malicioso.com', ['TEACHER'])).toBe('/maestro');
    expect(resolveNextPath(null, ['ADMIN'])).toBe('/admin');
  });
});
