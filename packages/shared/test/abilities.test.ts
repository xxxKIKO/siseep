import { subject } from '@casl/ability';
import { describe, expect, it } from 'vitest';
import { defineAbilityFor, isGrantActive, parseGrantAction } from '../src/abilities';
import type { AuthUser } from '../src/schemas/user';

// Permission tests: never delete or skip (see CLAUDE.md).

const SCHOOL = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const GROUP_A = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const GROUP_B = 'cccccccccccccccccccccccc';

const admin: AuthUser = { id: '111111111111111111111111', schoolId: SCHOOL, roles: ['ADMIN'] };
const teacher: AuthUser = { id: '222222222222222222222222', schoolId: SCHOOL, roles: ['TEACHER'] };
const director: AuthUser = {
  id: '333333333333333333333333',
  schoolId: SCHOOL,
  roles: ['DIRECTOR', 'TEACHER'],
};
const guardian: AuthUser = {
  id: '444444444444444444444444',
  schoolId: SCHOOL,
  roles: ['GUARDIAN'],
};

describe('defineAbilityFor', () => {
  it('lets ADMIN manage everything', () => {
    const ability = defineAbilityFor(admin);
    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('create', 'Invitation')).toBe(true);
    expect(ability.can('delete', 'Grade')).toBe(true);
  });

  it.each([teacher, director, guardian])('denies admin-only actions to %o', (user) => {
    const ability = defineAbilityFor(user);
    expect(ability.can('create', 'Invitation')).toBe(false);
    expect(ability.can('manage', 'User')).toBe(false);
    expect(ability.can('update', 'Period')).toBe(false);
  });

  it('lets every user read only their own profile', () => {
    const ability = defineAbilityFor(teacher);
    expect(ability.can('read', subject('User', { id: teacher.id }))).toBe(true);
    expect(ability.can('read', subject('User', { id: admin.id }))).toBe(false);
  });

  it('applies an active GROUP grant only to that group', () => {
    const ability = defineAbilityFor(director, [
      { action: 'grade:update', scope: { type: 'GROUP', groupId: GROUP_A } },
    ]);
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_A }))).toBe(
      true,
    );
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_B }))).toBe(
      false,
    );
    expect(ability.can('delete', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_A }))).toBe(
      false,
    );
  });

  it('applies a SCHOOL grant only inside the user school', () => {
    const ability = defineAbilityFor(director, [
      { action: 'grade:update', scope: { type: 'SCHOOL' } },
    ]);
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_B }))).toBe(
      true,
    );
    expect(ability.can('update', subject('Grade', { schoolId: 'dddddddddddddddddddddddd' }))).toBe(
      false,
    );
  });

  it('ignores expired grants', () => {
    const now = new Date('2026-12-01T12:00:00Z');
    const ability = defineAbilityFor(
      director,
      [
        {
          action: 'grade:update',
          scope: { type: 'SCHOOL' },
          expiresAt: new Date('2026-12-01T11:59:59Z'),
        },
      ],
      now,
    );
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL }))).toBe(false);
  });

  it('ignores malformed or escalating grants', () => {
    const ability = defineAbilityFor(teacher, [
      { action: 'grade:manage', scope: { type: 'SCHOOL' } },
      { action: 'user:update', scope: { type: 'SCHOOL' } },
      { action: 'grade:update', scope: { type: 'GROUP' } },
    ]);
    expect(ability.can('manage', subject('Grade', { schoolId: SCHOOL }))).toBe(false);
    expect(ability.can('update', subject('User', { schoolId: SCHOOL }))).toBe(false);
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_A }))).toBe(
      false,
    );
  });
});

describe('grant helpers', () => {
  it('parses known grant actions', () => {
    expect(parseGrantAction('grade:update')).toEqual(['update', 'Grade']);
    expect(parseGrantAction('note:create')).toEqual(['create', 'StudentNote']);
    expect(parseGrantAction('grade')).toBeNull();
    expect(parseGrantAction('grade:update:extra')).toBeNull();
    expect(parseGrantAction('unknown:read')).toBeNull();
  });

  it('treats grants without expiry as active', () => {
    expect(isGrantActive({ action: 'grade:update', scope: { type: 'SCHOOL' } })).toBe(true);
  });
});
