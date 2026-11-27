import { FIELD_COLORS, FIELD_KEYS, ROLE_LABELS } from '@siseep/shared/core';
import { LogOut } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '@/components/FullPageSpinner';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-context';
import { defaultRoleFor, roleFromPath } from '@/auth/roles';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { navItemsFor } from './nav';
import { RoleSwitcher } from './RoleSwitcher';

export const SCHOOL_SHORT_NAME = 'Esc. Prim. Salvador Allende';

/** Thin strip with the four formative field colors, used as a brand accent. */
export function FieldColorStrip({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-1', className)} aria-hidden>
      {FIELD_KEYS.map((key) => (
        <span key={key} className="flex-1" style={{ backgroundColor: FIELD_COLORS[key] }} />
      ))}
    </div>
  );
}

/**
 * Mobile-first shell: header + bottom navigation on phones and tablets,
 * fixed navy sidebar from 1024 px (lg).
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  if (!user) return null;

  const activeRole =
    roleFromPath(location.pathname) ?? defaultRoleFor(user.roles) ?? user.roles[0]!;
  const items = navItemsFor(activeRole);
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-primary text-primary-foreground lg:flex">
        <FieldColorStrip />
        <div className="px-5 pb-4 pt-5">
          <p className="text-xs font-medium uppercase tracking-wide text-white/70">Evaluación</p>
          <p className="text-base font-semibold leading-tight">{SCHOOL_SHORT_NAME}</p>
        </div>
        <div className="px-3">
          <RoleSwitcher roles={user.roles} activeRole={activeRole} tone="dark" />
        </div>
        <nav aria-label="Menú principal" className="mt-4 flex flex-1 flex-col gap-1 px-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-white text-primary' : 'text-white/90 hover:bg-white/10',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/15 p-3">
          <p className="truncate px-2 text-sm font-medium">{fullName}</p>
          <p className="truncate px-2 text-xs text-white/70">{ROLE_LABELS[activeRole]}</p>
          <Button
            variant="ghost"
            className="mt-2 w-full justify-start text-white hover:bg-white/10"
            onClick={handleLogout}
          >
            <LogOut aria-hidden /> Cerrar sesión
          </Button>
        </div>
      </aside>

      {/* Header (phones and tablets) */}
      <header className="sticky top-0 z-20 border-b border-border bg-card lg:hidden">
        <FieldColorStrip />
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-primary">{SCHOOL_SHORT_NAME}</p>
            <p className="truncate text-xs text-muted-foreground">{fullName}</p>
          </div>
          {user.roles.length > 1 ? (
            <div className="w-44 shrink-0">
              <RoleSwitcher roles={user.roles} activeRole={activeRole} />
            </div>
          ) : null}
        </div>
      </header>

      <main
        id="contenido"
        className="mx-auto w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"
      >
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Bottom navigation (phones and tablets) */}
      <nav
        aria-label="Menú principal"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto flex max-w-md">
          {items
            .filter((item) => item.mobile)
            .map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <item.icon className="size-6" aria-hidden />
                  {item.label}
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  );
}
