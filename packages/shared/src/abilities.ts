import {
  AbilityBuilder,
  createMongoAbility,
  type ForcedSubject,
  type MongoAbility,
} from '@casl/ability';
import { rulesToQuery } from '@casl/ability/extra';
import { Role, type SubjectKey } from './enums';
import type { AuthUser } from './schemas/user';

export { subject } from '@casl/ability';

export const ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * CASL subjects. Wrap records with `subject('Grade', doc)` to check conditions. Records must use
 * string ids (`_id`, `schoolId`, `groupId`) — the API converts ObjectIds before checking.
 */
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
  'Import',
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

/** What a teacher teaches (`teachingAssignments`). SUBJECT teachers only see their subject. */
export interface TeachingAssignmentLike {
  groupId: string;
  scope: 'HOMEROOM' | 'SUBJECT';
  subjectKey?: SubjectKey | null;
}

export interface AbilityContext {
  grants?: readonly PermissionGrantLike[];
  assignments?: readonly TeachingAssignmentLike[];
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

/** Everything a director can read in their school (section 2: "toda su escuela"). */
const SCHOOL_READABLE: SubjectName[] = [
  'SchoolYear',
  'Period',
  'GradingScheme',
  'Group',
  'Student',
  'Enrollment',
  'TeachingAssignment',
  'Activity',
  'Grade',
  'StudentNote',
  'PeriodResult',
  'Report',
  'AuditLog',
];
/** What the direction administers in its school (stage 6 changes requested by the school). */
const DIRECTOR_MANAGED: SubjectName[] = [
  'SchoolYear',
  'Period',
  'Group',
  'TeachingAssignment',
  'GuardianLink',
];
/** Day-to-day work of the homeroom teacher on their group. */
const HOMEROOM_WORK: SubjectName[] = ['Activity', 'Grade', 'PeriodResult'];
/** A subject teacher (English, PE) only works on activities and grades of their subject. */
const SUBJECT_WORK: SubjectName[] = ['Activity', 'Grade'];
const CRUD: Action[] = ['create', 'read', 'update', 'delete'];

/**
 * Builds the CASL ability for a user. Used by the API (PoliciesGuard + services) and by the
 * web (to hide buttons). The API is always the source of truth.
 *
 * - ADMIN: everything.
 * - DIRECTOR: reads the whole school and runs it: school settings, school years and periods
 *   (closing, publishing and reopening), groups and teacher assignments, staff accounts (the
 *   service limits which roles) and guardian accounts. Grades, activities, notes and period
 *   adjustments still need an active permission grant; grading rules, students and the Excel
 *   import stay with the admin.
 * - TEACHER: reads and writes in the groups they teach. A SUBJECT assignment is limited to its
 *   `subjectKey` (the English teacher never sees Saberes). Homeroom teachers read every note of
 *   their group but only edit their own; each teacher reads the audit log of their groups.
 *   The homeroom teacher also creates the guardian accounts of the students of their group.
 * - GUARDIAN: nothing in the school catalogs; only their own guardian links (the portal checks
 *   each child against an active link and answers 404 otherwise).
 *
 * The second argument also accepts a plain array of grants (stage 0 signature).
 */
export function defineAbilityFor(
  user: AuthUser,
  context: AbilityContext | readonly PermissionGrantLike[] = {},
  now: Date = new Date(),
): AppAbility {
  const { grants = [], assignments = [] } = Array.isArray(context)
    ? { grants: context as readonly PermissionGrantLike[] }
    : (context as AbilityContext);
  const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
  // String subjects make CASL type conditions as `never`; conditions are plain Mongo queries.
  const can = (
    action: Action | Action[],
    subject: SubjectName | SubjectName[],
    conditions?: Record<string, unknown>,
  ) =>
    conditions ? builder.can(action, subject, conditions as never) : builder.can(action, subject);
  const schoolId = user.schoolId;

  if (user.roles.includes(Role.ADMIN)) {
    can('manage', 'all');
    return builder.build();
  }

  can('read', 'User', { _id: user.id });
  can('read', 'School', { _id: schoolId });

  if (user.roles.includes(Role.DIRECTOR)) {
    can('read', SCHOOL_READABLE, { schoolId });
    can('manage', DIRECTOR_MANAGED, { schoolId });
    // The school document is identified by its own _id.
    can(['read', 'update'], 'School', { _id: schoolId });
    can(['create', 'read', 'update'], 'User', { schoolId });
  }

  if (user.roles.includes(Role.TEACHER)) {
    can('read', ['SchoolYear', 'Period', 'GradingScheme'], { schoolId });
    for (const assignment of assignments) {
      const groupId = assignment.groupId;
      can('read', 'Group', { _id: groupId, schoolId });
      can('read', ['Enrollment', 'TeachingAssignment'], { groupId, schoolId });
      if (assignment.scope === 'HOMEROOM') {
        can(CRUD, HOMEROOM_WORK, { groupId, schoolId });
        // Notes: everyone's notes of the group are readable; only your own are editable.
        can(['create', 'read'], 'StudentNote', { groupId, schoolId });
        can(['update', 'delete'], 'StudentNote', { groupId, schoolId, authorId: user.id });
        can('read', 'AuditLog', { groupId, schoolId });
        can(['create', 'read'], 'GuardianLink', { groupId, schoolId });
      } else if (assignment.subjectKey) {
        can(CRUD, SUBJECT_WORK, { groupId, schoolId, subjectKey: assignment.subjectKey });
        can('read', 'AuditLog', { groupId, schoolId, subjectKey: assignment.subjectKey });
      }
    }
  }

  if (user.roles.includes(Role.GUARDIAN)) {
    can('read', 'GuardianLink', { guardianUserId: user.id, status: 'ACTIVE' });
  }

  for (const grant of grants) {
    if (!isGrantActive(grant, now)) continue;
    const parsed = parseGrantAction(grant.action);
    if (!parsed) continue;
    const [action, subject] = parsed;
    const conditions =
      grant.scope.type === 'GROUP'
        ? grant.scope.groupId
          ? { schoolId, groupId: grant.scope.groupId }
          : null
        : { schoolId };
    if (!conditions) continue;
    can([action, 'read'], subject, conditions);
  }

  return builder.build();
}

/**
 * Mongo filter with exactly the records `ability` allows for `action` on `subjectType`
 * (built from the same CASL rules, so lists and 403s never disagree).
 *
 * Returns `null` when nothing is allowed and `{}` when everything is. Services must still add
 * `schoolId` themselves: ADMIN's rule has no conditions.
 */
export function scopeFilter(
  ability: AppAbility,
  subjectType: Exclude<SubjectName, 'all'>,
  action: Action = 'read',
): Record<string, unknown> | null {
  const query = rulesToQuery(ability, action, subjectType, (rule) =>
    rule.inverted ? { $nor: [rule.conditions] } : (rule.conditions as object),
  );
  return query as Record<string, unknown> | null;
}

/** The ability rebuilt from the rules the API sends (`GET /auth/abilities`), for the web. */
export function abilityFromRules(rules: unknown[]): AppAbility {
  return createMongoAbility<AppAbility>(rules as AppAbility['rules']);
}
