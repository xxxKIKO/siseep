import {
  type Action,
  type AppAbility,
  scopeFilter,
  subject,
  type SubjectName,
} from '@siseep/shared';
import { Types } from 'mongoose';
import { Errors } from './app.exception';
import type { Actor } from './request-user';

type ScopedSubject = Exclude<SubjectName, 'all'>;

/** Converts ObjectIds (and nested ones) to strings so CASL conditions can compare them. */
function plain(value: unknown): unknown {
  if (value instanceof Types.ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const source =
      typeof (value as { toObject?: unknown }).toObject === 'function'
        ? (value as { toObject: () => object }).toObject()
        : value;
    return Object.fromEntries(Object.entries(source).map(([key, v]) => [key, plain(v)]));
  }
  return value;
}

/** A Mongo document (or lean object) as a CASL subject. */
export function asSubject(name: ScopedSubject, doc: object) {
  return subject(name, plain(doc) as Record<string, unknown>);
}

/** Throws 403 unless `ability` allows `action` on this specific record. */
export function assertCan(
  ability: AppAbility,
  action: Action,
  name: ScopedSubject,
  doc: object,
): void {
  if (!ability.can(action, asSubject(name, doc))) throw Errors.forbidden();
}

/**
 * Mongo filter for the records the actor may see: always the actor's school, plus the CASL
 * scope (assigned groups, subject...). Returns null when nothing is visible.
 */
export function scopedQuery(
  actor: Actor,
  name: ScopedSubject,
  action: Action = 'read',
): Record<string, unknown> | null {
  const scope = scopeFilter(actor.ability, name, action);
  if (scope === null) return null;
  return { $and: [{ schoolId: new Types.ObjectId(actor.user.schoolId) }, scope] };
}

/** Like scopedQuery but throws 403 when the actor sees nothing of this subject. */
export function requireScopedQuery(
  actor: Actor,
  name: ScopedSubject,
  action: Action = 'read',
): Record<string, unknown> {
  const query = scopedQuery(actor, name, action);
  if (!query) throw Errors.forbidden();
  return query;
}

export function oid(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

/** Full name in Mexican order: paternal surname, maternal surname, given names. */
export function studentFullName(s: { firstName: string; lastName1: string; lastName2?: string }) {
  return [s.lastName1, s.lastName2, s.firstName].filter(Boolean).join(' ');
}

export function teacherSummary(u: {
  _id: Types.ObjectId;
  firstName: string;
  lastName?: string;
  email: string;
}) {
  return {
    id: u._id.toString(),
    name: `${u.firstName} ${u.lastName ?? ''}`.trim(),
    email: u.email,
  };
}
