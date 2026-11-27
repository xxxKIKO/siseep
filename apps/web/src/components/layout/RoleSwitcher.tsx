import { type Role, ROLE_HOME_PATHS, ROLE_LABELS } from '@siseep/shared/core';
import { ChevronsUpDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { setPreferredRole } from '@/auth/roles';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

interface RoleSwitcherProps {
  roles: readonly Role[];
  activeRole: Role;
  /** `dark` for the navy sidebar, `light` for the mobile header. */
  tone?: 'dark' | 'light';
}

/** Shown only to users with more than one role. Switches between their portals. */
export function RoleSwitcher({ roles, activeRole, tone = 'light' }: RoleSwitcherProps) {
  const navigate = useNavigate();
  if (roles.length < 2) return null;

  const change = (value: string) => {
    const role = value as Role;
    setPreferredRole(role);
    navigate(ROLE_HOME_PATHS[role]);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Cambiar de rol. Rol actual: ${ROLE_LABELS[activeRole]}`}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm font-medium',
          tone === 'dark'
            ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
            : 'border-border bg-card text-foreground hover:bg-muted',
        )}
      >
        <span className="flex flex-col leading-tight">
          <span
            className={cn('text-xs', tone === 'dark' ? 'text-white/70' : 'text-muted-foreground')}
          >
            Entrar como
          </span>
          <span>{ROLE_LABELS[activeRole]}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Cambiar de rol</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeRole} onValueChange={change}>
          {roles.map((role) => (
            <DropdownMenuRadioItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
