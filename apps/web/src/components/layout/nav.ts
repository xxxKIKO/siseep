import { type Role, ROLE_HOME_PATHS } from '@siseep/shared';
import { House, type LucideIcon, UserRound } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match only the exact path (for portal homes). */
  end?: boolean;
}

/** Menu of each portal. Later stages add their screens here. */
export function navItemsFor(role: Role): NavItem[] {
  return [
    { to: ROLE_HOME_PATHS[role], label: 'Inicio', icon: House, end: true },
    { to: '/cuenta', label: 'Mi cuenta', icon: UserRound },
  ];
}
