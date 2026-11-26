import { ROLE_HOME_PATHS, type Role } from '@siseep/shared';
import type { RouteObject } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole, RootRedirect } from '@/auth/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { AccountPage } from '@/pages/AccountPage';
import { AcceptInvitePage } from '@/pages/auth/AcceptInvitePage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const PORTAL_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'TEACHER', 'GUARDIAN'];

/** Portal per role: /admin, /director, /maestro, /padres. */
const portalRoutes: RouteObject[] = PORTAL_ROLES.map((role) => ({
  path: ROLE_HOME_PATHS[role],
  element: <RequireRole role={role} />,
  children: [{ index: true, element: <ComingSoonPage role={role} /> }],
}));

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  {
    element: <GuestOnly />,
    children: [
      { path: '/iniciar-sesion', element: <LoginPage /> },
      { path: '/olvide-contrasena', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/restablecer', element: <ResetPasswordPage /> },
  { path: '/invitacion', element: <AcceptInvitePage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [...portalRoutes, { path: '/cuenta', element: <AccountPage /> }],
  },
  { path: '*', element: <NotFoundPage /> },
];
