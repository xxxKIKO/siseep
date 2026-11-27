import type { Role } from '@siseep/shared';
import { type ReactNode, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { useAuth } from './auth-context';
import { homePathFor, resolveNextPath, setPreferredRole } from './roles';

/**
 * Only signed-in users. Others go to the login page and come back afterwards. An account with a
 * temporary password goes first to /cambiar-contrasena (the API blocks everything else anyway).
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/iniciar-sesion?siguiente=${encodeURIComponent(next)}`} replace />;
  }
  if (user?.mustChangePassword) return <Navigate to="/cambiar-contrasena" replace />;
  return children ?? <Outlet />;
}

/** /cambiar-contrasena: signed-in users with a temporary password; others go to their portal. */
export function RequireTemporaryPassword({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (!user) return <Navigate to="/iniciar-sesion" replace />;
  if (!user.mustChangePassword) return <Navigate to={homePathFor(user.roles)} replace />;
  return children ?? <Outlet />;
}

/**
 * Only users with this role. Anyone else is sent to their own portal. This only hides
 * screens: the API checks every permission again.
 */
export function RequireRole({ role, children }: { role: Role; children?: ReactNode }) {
  const { user } = useAuth();
  const allowed = user?.roles.includes(role) ?? false;
  useEffect(() => {
    if (allowed) setPreferredRole(role);
  }, [allowed, role]);

  if (!user) return null;
  if (!allowed) return <Navigate to={homePathFor(user.roles)} replace />;
  return children ?? <Outlet />;
}

/**
 * Login and password recovery. A signed-in user (including right after logging in) goes to
 * the page in `?siguiente=` when allowed, else to their portal.
 */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  const [searchParams] = useSearchParams();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated' && user?.mustChangePassword) {
    return <Navigate to="/cambiar-contrasena" replace />;
  }
  if (status === 'authenticated' && user) {
    return <Navigate to={resolveNextPath(searchParams.get('siguiente'), user.roles)} replace />;
  }
  return children ?? <Outlet />;
}

/** `/` → the user's portal or the login page. */
export function RootRedirect() {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullPageSpinner />;
  if (!user) return <Navigate to="/iniciar-sesion" replace />;
  return <Navigate to={homePathFor(user.roles)} replace />;
}
