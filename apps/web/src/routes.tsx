import { ROLE_HOME_PATHS, type Role } from '@siseep/shared';
import type { RouteObject } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole, RootRedirect } from '@/auth/guards';
import { AppLayout } from '@/components/layout/AppLayout';
import { AccountPage } from '@/pages/AccountPage';
import { AcceptInvitePage } from '@/pages/auth/AcceptInvitePage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { AdminHomePage } from '@/pages/admin/AdminHomePage';
import { GradingSchemePage } from '@/pages/admin/GradingSchemePage';
import { GrantsPage } from '@/pages/admin/GrantsPage';
import { GroupDetailPage } from '@/pages/admin/GroupDetailPage';
import { GroupsPage } from '@/pages/admin/GroupsPage';
import { ImportPage } from '@/pages/admin/ImportPage';
import { SchoolPage } from '@/pages/admin/SchoolPage';
import { SchoolYearsPage } from '@/pages/admin/SchoolYearsPage';
import { StudentsPage } from '@/pages/admin/StudentsPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { TeacherGroupPage } from '@/pages/teacher/TeacherGroupPage';
import { TeacherHomePage } from '@/pages/teacher/TeacherHomePage';

/** Screens of each portal. Portals without screens yet show "Próximamente". */
const PORTAL_CHILDREN: Record<Role, RouteObject[]> = {
  ADMIN: [
    { index: true, element: <AdminHomePage /> },
    { path: 'escuela', element: <SchoolPage /> },
    { path: 'ciclos', element: <SchoolYearsPage /> },
    { path: 'ciclos/:yearId/reglas', element: <GradingSchemePage /> },
    { path: 'grupos', element: <GroupsPage /> },
    { path: 'grupos/:groupId', element: <GroupDetailPage /> },
    { path: 'alumnos', element: <StudentsPage /> },
    { path: 'usuarios', element: <UsersPage /> },
    { path: 'permisos', element: <GrantsPage /> },
    { path: 'importar', element: <ImportPage /> },
  ],
  DIRECTOR: [{ index: true, element: <ComingSoonPage role="DIRECTOR" /> }],
  TEACHER: [
    { index: true, element: <TeacherHomePage /> },
    { path: 'grupos/:groupId', element: <TeacherGroupPage /> },
  ],
  GUARDIAN: [{ index: true, element: <ComingSoonPage role="GUARDIAN" /> }],
};

/** Portal per role: /admin, /director, /maestro, /padres. */
const portalRoutes: RouteObject[] = (Object.keys(PORTAL_CHILDREN) as Role[]).map((role) => ({
  path: ROLE_HOME_PATHS[role],
  element: <RequireRole role={role} />,
  children: PORTAL_CHILDREN[role],
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
