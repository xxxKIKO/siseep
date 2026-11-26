import type { Role, User } from '@siseep/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes';
import { AuthContext, type AuthContextValue } from './auth-context';

// Permission tests (UI side): never delete or skip (see CLAUDE.md).

function userWith(roles: Role[]): User {
  return {
    id: '111111111111111111111111',
    schoolId: '222222222222222222222222',
    email: 'persona@escuela.mx',
    firstName: 'Viry',
    lastName: 'Prueba',
    roles,
    status: 'ACTIVE',
  };
}

// MemoryRouter + useRoutes: same route tree as the app, without the data router's
// Request/AbortSignal objects that clash between jsdom and Node's fetch.
function AppRoutes() {
  const location = useLocation();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      {useRoutes(routes)}
    </>
  );
}

const currentLocation = () => screen.getByTestId('location').textContent;

/** Text that only the home of each portal shows. */
const HOME_MARKERS: Record<Role, string> = {
  ADMIN: 'Importar Excel',
  DIRECTOR: 'Tablero de la escuela',
  TEACHER: 'Aún no tienes grupos asignados. Pide a la administración que te asigne a tu grupo.',
  GUARDIAN: 'Próximamente',
};
const findHome = (role: Role) => screen.findByText(HOME_MARKERS[role]);

// Portal homes load data: the API answers with empty lists.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string, user: User | null) {
  const auth: AuthContextValue = {
    status: user ? 'authenticated' : 'anonymous',
    user,
    login: vi.fn(),
    startSession: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('role-protected routes', () => {
  it.each<[Role, string]>([
    ['ADMIN', '/admin'],
    ['DIRECTOR', '/director'],
    ['TEACHER', '/maestro'],
    ['GUARDIAN', '/padres'],
  ])('%s opens their own home', async (role, path) => {
    renderAt(path, userWith([role]));
    expect(await findHome(role)).toBeInTheDocument();
    expect(currentLocation()).toBe(path);
  });

  it.each(['/admin', '/director', '/padres'])(
    'a TEACHER who opens %s is sent back to /maestro',
    async (path) => {
      renderAt(path, userWith(['TEACHER']));
      expect(await findHome('TEACHER')).toBeInTheDocument();
      expect(currentLocation()).toBe('/maestro');
    },
  );

  it('sends anonymous users to the login page and remembers where they were going', async () => {
    renderAt('/director', null);
    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(currentLocation()).toBe('/iniciar-sesion?siguiente=%2Fdirector');
  });

  it('opens the highest-priority portal from / for a user with several roles', async () => {
    renderAt('/', userWith(['TEACHER', 'DIRECTOR']));
    expect(await findHome('DIRECTOR')).toBeInTheDocument();
    expect(currentLocation()).toBe('/director');
  });
});

describe('admin screens (stage 1)', () => {
  it.each(['/admin/grupos', '/admin/importar', '/admin/usuarios', '/admin/permisos'])(
    'a TEACHER who opens %s is sent back to /maestro',
    async (path) => {
      renderAt(path, userWith(['TEACHER']));
      expect(await findHome('TEACHER')).toBeInTheDocument();
      expect(currentLocation()).toBe('/maestro');
    },
  );

  it('a DIRECTOR cannot open the admin screens either', async () => {
    renderAt('/admin/alumnos', userWith(['DIRECTOR']));
    expect(await findHome('DIRECTOR')).toBeInTheDocument();
    expect(currentLocation()).toBe('/director');
  });
});

describe('role switcher', () => {
  it('appears only for users with several roles', async () => {
    renderAt('/director', userWith(['DIRECTOR', 'TEACHER']));
    expect(await screen.findAllByRole('button', { name: /Cambiar de rol/ })).not.toHaveLength(0);
  });

  it('is hidden for users with a single role', async () => {
    renderAt('/maestro', userWith(['TEACHER']));
    await findHome('TEACHER');
    expect(screen.queryByRole('button', { name: /Cambiar de rol/ })).not.toBeInTheDocument();
  });
});
