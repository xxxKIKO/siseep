import { describe, expect, it } from 'vitest';
import { defineAbilityFor, scopeFilter, subject } from '../src/abilities';
import type { AuthUser } from '../src/schemas/user';

// Permission tests: never delete or skip (see CLAUDE.md).

const SCHOOL = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER_SCHOOL = 'ffffffffffffffffffffffff';
const GROUP_5B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const GROUP_4A = 'cccccccccccccccccccccccc';

const user = (roles: AuthUser['roles'], id = '111111111111111111111111'): AuthUser => ({
  id,
  schoolId: SCHOOL,
  roles,
});

const activity = (groupId: string, extra: Record<string, unknown> = {}) =>
  subject('Activity', { schoolId: SCHOOL, groupId, ...extra });

describe('TEACHER', () => {
  const homeroom = defineAbilityFor(user(['TEACHER']), {
    assignments: [{ groupId: GROUP_5B, scope: 'HOMEROOM' }],
  });

  it('reads and writes everything of their group', () => {
    expect(homeroom.can('read', subject('Group', { _id: GROUP_5B, schoolId: SCHOOL }))).toBe(true);
    expect(homeroom.can('update', activity(GROUP_5B, { subjectKey: 'ingles' }))).toBe(true);
    expect(homeroom.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_5B }))).toBe(
      true,
    );
  });

  it('cannot see another group', () => {
    expect(homeroom.can('read', subject('Group', { _id: GROUP_4A, schoolId: SCHOOL }))).toBe(false);
    expect(homeroom.can('read', activity(GROUP_4A))).toBe(false);
    expect(
      homeroom.can('read', subject('Enrollment', { schoolId: SCHOOL, groupId: GROUP_4A })),
    ).toBe(false);
  });

  it('cannot touch school catalogs', () => {
    expect(homeroom.can('create', 'Group')).toBe(false);
    expect(homeroom.can('create', 'Student')).toBe(false);
    expect(homeroom.can('update', subject('Period', { schoolId: SCHOOL }))).toBe(false);
    expect(homeroom.can('read', 'PermissionGrant')).toBe(false);
  });

  it('an English teacher only sees English activities', () => {
    const english = defineAbilityFor(user(['TEACHER']), {
      assignments: [{ groupId: GROUP_5B, scope: 'SUBJECT', subjectKey: 'ingles' }],
    });
    expect(english.can('read', subject('Group', { _id: GROUP_5B, schoolId: SCHOOL }))).toBe(true);
    expect(english.can('update', activity(GROUP_5B, { subjectKey: 'ingles' }))).toBe(true);
    expect(english.can('read', activity(GROUP_5B, { fieldKey: 'saberes' }))).toBe(false);
    expect(english.can('read', activity(GROUP_5B, { subjectKey: 'ed_fisica' }))).toBe(false);
    expect(
      english.can('read', subject('StudentNote', { schoolId: SCHOOL, groupId: GROUP_5B })),
    ).toBe(false);
  });

  it('without assignments sees no groups', () => {
    const ability = defineAbilityFor(user(['TEACHER']));
    expect(scopeFilter(ability, 'Group')).toBeNull();
  });
});

describe('DIRECTOR', () => {
  const director = user(['DIRECTOR'], '333333333333333333333333');

  it('reads the whole school but nothing outside it', () => {
    const ability = defineAbilityFor(director);
    expect(ability.can('read', activity(GROUP_4A))).toBe(true);
    expect(ability.can('read', subject('Student', { schoolId: SCHOOL }))).toBe(true);
    expect(ability.can('read', subject('Student', { schoolId: OTHER_SCHOOL }))).toBe(false);
  });

  it('cannot edit without a grant', () => {
    const ability = defineAbilityFor(director);
    expect(ability.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_5B }))).toBe(
      false,
    );
    expect(ability.can('create', 'Group')).toBe(false);
  });

  it('edits only where an active grant applies', () => {
    const now = new Date('2026-12-01T12:00:00Z');
    const grant = {
      action: 'grade:update',
      scope: { type: 'GROUP' as const, groupId: GROUP_5B },
      expiresAt: new Date('2026-12-03T12:00:00Z'),
    };
    const active = defineAbilityFor(director, { grants: [grant] }, now);
    expect(active.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_5B }))).toBe(
      true,
    );
    expect(active.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_4A }))).toBe(
      false,
    );

    const expired = defineAbilityFor(
      director,
      { grants: [grant] },
      new Date('2026-12-04T00:00:00Z'),
    );
    expect(expired.can('update', subject('Grade', { schoolId: SCHOOL, groupId: GROUP_5B }))).toBe(
      false,
    );
  });
});

describe('GUARDIAN', () => {
  it('has no access to school catalogs', () => {
    const ability = defineAbilityFor(user(['GUARDIAN']));
    for (const name of ['Group', 'Student', 'Enrollment', 'Activity', 'Period'] as const) {
      expect(scopeFilter(ability, name)).toBeNull();
    }
  });
});

describe('scopeFilter', () => {
  it('returns {} for ADMIN (services add schoolId)', () => {
    expect(scopeFilter(defineAbilityFor(user(['ADMIN'])), 'Group')).toEqual({});
  });

  it('returns the teacher groups as a Mongo filter', () => {
    const ability = defineAbilityFor(user(['TEACHER']), {
      assignments: [
        { groupId: GROUP_5B, scope: 'HOMEROOM' },
        { groupId: GROUP_4A, scope: 'SUBJECT', subjectKey: 'ingles' },
      ],
    });
    const groups = scopeFilter(ability, 'Group');
    expect(groups?.$or).toEqual(
      expect.arrayContaining([
        { _id: GROUP_5B, schoolId: SCHOOL },
        { _id: GROUP_4A, schoolId: SCHOOL },
      ]),
    );
    const activities = scopeFilter(ability, 'Activity');
    expect(activities?.$or).toEqual(
      expect.arrayContaining([
        { groupId: GROUP_5B, schoolId: SCHOOL },
        { groupId: GROUP_4A, schoolId: SCHOOL, subjectKey: 'ingles' },
      ]),
    );
  });

  it('a multi-role DIRECTOR + TEACHER keeps the director read scope', () => {
    const ability = defineAbilityFor(user(['DIRECTOR', 'TEACHER']), {
      assignments: [{ groupId: GROUP_5B, scope: 'HOMEROOM' }],
    });
    expect(ability.can('read', activity(GROUP_4A))).toBe(true);
    expect(ability.can('update', activity(GROUP_4A))).toBe(false);
    expect(ability.can('update', activity(GROUP_5B))).toBe(true);
  });
});
