import { type Role, ROLE_HOME_PATHS, ROLES } from '@siseep/shared/core';

/** When a user has several roles, this is the default order to pick their portal. */
export const ROLE_PRIORITY: readonly Role[] = ['ADMIN', 'DIRECTOR', 'TEACHER', 'GUARDIAN'];

const PREFERRED_ROLE_KEY = 'siseep.preferredRole';

/** Role whose portal contains this path, if any (`/maestro/...` → TEACHER). */
export function roleFromPath(pathname: string): Role | null {
  for (const role of ROLES) {
    const home = ROLE_HOME_PATHS[role];
    if (pathname === home || pathname.startsWith(`${home}/`)) return role;
  }
  return null;
}

export function getPreferredRole(): Role | null {
  try {
    const value = localStorage.getItem(PREFERRED_ROLE_KEY);
    return value && (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
  } catch {
    return null;
  }
}

/** Remembers the last portal used (not sensitive: only the role name). */
export function setPreferredRole(role: Role): void {
  try {
    localStorage.setItem(PREFERRED_ROLE_KEY, role);
  } catch {
    // Private mode or storage disabled: the choice just is not remembered.
  }
}

/** The portal to open for a user: their remembered role if they still have it, else by priority. */
export function defaultRoleFor(roles: readonly Role[]): Role | null {
  const preferred = getPreferredRole();
  if (preferred && roles.includes(preferred)) return preferred;
  return ROLE_PRIORITY.find((role) => roles.includes(role)) ?? null;
}

export function homePathFor(roles: readonly Role[]): string {
  const role = defaultRoleFor(roles);
  return role ? ROLE_HOME_PATHS[role] : '/iniciar-sesion';
}

/** Where to go after login: the requested page if the user can open it, else their portal. */
export function resolveNextPath(next: string | null, roles: readonly Role[]): string {
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    const allowed = roles.some(
      (role) => next === ROLE_HOME_PATHS[role] || next.startsWith(`${ROLE_HOME_PATHS[role]}/`),
    );
    // /registro: a signed-in guardian finishes redeeming a code after logging in.
    if (allowed || next.startsWith('/cuenta') || next.startsWith('/registro')) return next;
  }
  return homePathFor(roles);
}
