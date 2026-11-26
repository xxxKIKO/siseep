import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import { Role } from './enums';
import type { AuthUser } from './schemas/user';

export const ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/** CASL subjects. Wrap records with `subject('Grade', doc)` to check conditions. */
export const SUBJECTS = [
  'all',
  'School',
  'User',
  'Invitation',
  'PermissionGrant',
  'SchoolYear',
  'Period',
  'GradingScheme',
  'Group',
  'Student',
  'Enrollment',
  'TeachingAssignment',
  'GuardianLink',
  'Activity',
  'Grade',
  'StudentNote',
  'PeriodResult',
  'Report',
  'AuditLog',
] as const;
export type SubjectName = (typeof SUBJECTS)[number];
/** A record tagged with its subject name via `subject('Grade', doc)`. */
export type SubjectRecord = ForcedSubject<Exclude<SubjectName, 'all'>>;
export type Subject = SubjectName | SubjectRecord;

export type AppAbility = MongoAbility<[Action, Subject]>;

/**
 * Special permission given by an admin (section 2, `permissionGrants`).
 * `action` looks like `grade:update`; `scope` limits it to the school or one group.
 */
export interface PermissionGrantLike {
  action: string;
  scope: { type: 'SCHOOL' | 'GROUP'; groupId?: string | null };
  expiresAt?: Date | string | null;
}

/** Maps the resource prefix of a grant action (`grade:update`) to its CASL subject. */
const GRANT_SUBJECTS: Record<string, SubjectName> = {
  activity: 'Activity',
  grade: 'Grade',
  note: 'StudentNote',
  periodResult: 'PeriodResult',
  period: 'Period',
  report: 'Report',
};

/** Returns the grant's [action, subject], or null if the grant action is not recognized. */
export function parseGrantAction(action: string): [Action, SubjectName] | null {
  const [resource, verb, ...rest] = action.split(':');
  if (!resource || !verb || rest.length > 0) return null;
  const subject = GRANT_SUBJECTS[resource];
  if (!subject || verb === 'manage' || !(ACTIONS as readonly string[]).includes(verb)) {
    return null;
  }
  return [verb as Action, subject];
}

export function isGrantActive(grant: PermissionGrantLike, now: Date = new Date()): boolean {
  if (!grant.expiresAt) return true;
  return new Date(grant.expiresAt).getTime() > now.getTime();
}

/**
 * Builds the CASL ability for a user. Used by the API (PoliciesGuard) and by the web
 * (to hide buttons). The API is always the source of truth.
 *
 * Stage 0 rules: ADMIN manages everything; every user reads their own profile and
 * their school; active grants add scoped permissions. Stage 1 extends this per role.
 */
export function defineAbilityFor(
  user: AuthUser,
  grants: readonly PermissionGrantLike[] = [],
  now: Date = new Date(),
): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  // String subjects make CASL type conditions as `never`; conditions are plain Mongo queries.
  const can = (action: Action, subject: SubjectName, conditions?: Record<string, unknown>) =>
    conditions ? builder.can(action, subject, conditions as never) : builder.can(action, subject);
  const build = () => builder.build();

  if (user.roles.includes(Role.ADMIN)) {
    can('manage', 'all');
    return build();
  }

  can('read', 'User', { id: user.id });
  can('read', 'School', { id: user.schoolId });

  for (const grant of grants) {
    if (!isGrantActive(grant, now)) continue;
    const parsed = parseGrantAction(grant.action);
    if (!parsed) continue;
    const [action, subject] = parsed;
    if (grant.scope.type === 'GROUP') {
      if (!grant.scope.groupId) continue;
      can(action, subject, { schoolId: user.schoolId, groupId: grant.scope.groupId });
    } else {
      can(action, subject, { schoolId: user.schoolId });
    }
  }

  return build();
}
