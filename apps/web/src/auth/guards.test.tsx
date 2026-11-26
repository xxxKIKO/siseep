import type { Role, User } from '@siseep/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useRoutes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
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
  ])('%s opens their own home with "Próximamente"', async (role, path) => {
    renderAt(path, userWith([role]));
    expect(await screen.findByText('Próximamente')).toBeInTheDocument();
    expect(currentLocation()).toBe(path);
  });

  it.each(['/admin', '/director', '/padres'])(
    'a TEACHER who opens %s is sent back to /maestro',
    async (path) => {
      renderAt(path, userWith(['TEACHER']));
      expect(await screen.findByText('Próximamente')).toBeInTheDocument();
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
    expect(await screen.findByText('Próximamente')).toBeInTheDocument();
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
    await screen.findByText('Próximamente');
    expect(screen.queryByRole('button', { name: /Cambiar de rol/ })).not.toBeInTheDocument();
  });
});
