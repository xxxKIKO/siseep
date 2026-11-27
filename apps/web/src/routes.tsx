import { ROLE_HOME_PATHS, type Role } from '@siseep/shared/core';
import { lazy, type ReactNode, Suspense } from 'react';
import type { RouteObject } from 'react-router';
import { GuestOnly, RequireAuth, RequireRole, RootRedirect } from '@/auth/guards';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { AppLayout } from '@/components/layout/AppLayout';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** `lazy` for a named export: each portal is its own chunk (stage 6, performance). */
// Function components only: their props are kept (e.g. ClosingPage's backTo).
function lazyPage<M extends Record<K, (props: P) => ReactNode>, K extends keyof M, P = never>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
const publicPages = () => import('@/portals/public');
const admin = () => import('@/portals/admin');
const teacher = () => import('@/portals/teacher');
const director = () => import('@/portals/director');
const guardian = () => import('@/portals/guardian');

const LoginPage = lazyPage(publicPages, 'LoginPage');
const AccountPage = lazyPage(publicPages, 'AccountPage');
const AcceptInvitePage = lazyPage(publicPages, 'AcceptInvitePage');
const ForgotPasswordPage = lazyPage(publicPages, 'ForgotPasswordPage');
const ResetPasswordPage = lazyPage(publicPages, 'ResetPasswordPage');
const GuardianSignUpPage = lazyPage(publicPages, 'GuardianSignUpPage');
const PrivacyPage = lazyPage(publicPages, 'PrivacyPage');
const AdminHomePage = lazyPage(admin, 'AdminHomePage');
const GradingSchemePage = lazyPage(admin, 'GradingSchemePage');
const GrantsPage = lazyPage(admin, 'GrantsPage');
const GroupDetailPage = lazyPage(admin, 'GroupDetailPage');
const GroupsPage = lazyPage(admin, 'GroupsPage');
const ImportPage = lazyPage(admin, 'ImportPage');
const PeriodsPage = lazyPage(admin, 'PeriodsPage');
const SchoolPage = lazyPage(admin, 'SchoolPage');
const SchoolYearsPage = lazyPage(admin, 'SchoolYearsPage');
const StudentsPage = lazyPage(admin, 'StudentsPage');
const UsersPage = lazyPage(admin, 'UsersPage');
const AdminClosingPage = lazyPage(admin, 'ClosingPage');
const ClosingPage = lazyPage(teacher, 'ClosingPage');
const CapturePage = lazyPage(teacher, 'CapturePage');
const GroupSummaryPage = lazyPage(teacher, 'GroupSummaryPage');
const GuardiansPage = lazyPage(teacher, 'GuardiansPage');
const StudentFilePage = lazyPage(teacher, 'StudentFilePage');
const TeacherGroupPage = lazyPage(teacher, 'TeacherGroupPage');
const TeacherHomePage = lazyPage(teacher, 'TeacherHomePage');
const AuditPage = lazyPage(director, 'AuditPage');
const DirectorDashboardPage = lazyPage(director, 'DirectorDashboardPage');
const AddChildPage = lazyPage(guardian, 'AddChildPage');
const ChildPage = lazyPage(guardian, 'ChildPage');
const GuardianHomePage = lazyPage(guardian, 'GuardianHomePage');

/** Screens of each portal (each portal is loaded on demand). */
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
    { path: 'periodos', element: <PeriodsPage /> },
    {
      path: 'grupos/:groupId/cierre',
      element: <AdminClosingPage backTo={() => ({ to: '/admin/periodos', label: 'Periodos' })} />,
    },
  ],
  // The director reuses the teacher screens: editing depends on the CASL ability (grants).
  DIRECTOR: [
    { index: true, element: <DirectorDashboardPage /> },
    { path: 'grupos/:groupId', element: <TeacherGroupPage /> },
    { path: 'grupos/:groupId/resumen', element: <GroupSummaryPage /> },
    { path: 'grupos/:groupId/alumnos/:studentId', element: <StudentFilePage /> },
    {
      path: 'grupos/:groupId/cierre',
      element: (
        <ClosingPage
          backTo={(id, name) => ({ to: `/director/grupos/${id}`, label: `Grupo ${name}` })}
        />
      ),
    },
    { path: 'actividades/:activityId', element: <CapturePage /> },
    { path: 'bitacora', element: <AuditPage /> },
  ],
  TEACHER: [
    { index: true, element: <TeacherHomePage /> },
    { path: 'grupos/:groupId', element: <TeacherGroupPage /> },
    { path: 'grupos/:groupId/resumen', element: <GroupSummaryPage /> },
    {
      path: 'grupos/:groupId/cierre',
      element: (
        <ClosingPage
          backTo={(id, name) => ({ to: `/maestro/grupos/${id}`, label: `Grupo ${name}` })}
        />
      ),
    },
    { path: 'grupos/:groupId/alumnos/:studentId', element: <StudentFilePage /> },
    { path: 'actividades/:activityId', element: <CapturePage /> },
    { path: 'grupos/:groupId/padres', element: <GuardiansPage /> },
  ],
  GUARDIAN: [
    { index: true, element: <GuardianHomePage /> },
    { path: 'hijos/:studentId', element: <ChildPage /> },
    { path: 'agregar', element: <AddChildPage /> },
  ],
};

/** Portal per role: /admin, /director, /maestro, /padres. */
const portalRoutes: RouteObject[] = (Object.keys(PORTAL_CHILDREN) as Role[]).map((role) => ({
  path: ROLE_HOME_PATHS[role],
  element: <RequireRole role={role} />,
  children: PORTAL_CHILDREN[role],
}));

/** Pages outside the app layout wait for their chunk with a spinner. */
const suspended = (page: ReactNode) => <Suspense fallback={<FullPageSpinner />}>{page}</Suspense>;

export const routes: RouteObject[] = [
  { path: '/', element: <RootRedirect /> },
  {
    element: <GuestOnly />,
    children: [
      { path: '/iniciar-sesion', element: suspended(<LoginPage />) },
      { path: '/olvide-contrasena', element: suspended(<ForgotPasswordPage />) },
    ],
  },
  { path: '/restablecer', element: suspended(<ResetPasswordPage />) },
  { path: '/invitacion', element: suspended(<AcceptInvitePage />) },
  { path: '/registro', element: suspended(<GuardianSignUpPage />) },
  { path: '/privacidad', element: suspended(<PrivacyPage />) },
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
