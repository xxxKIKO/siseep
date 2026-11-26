import { type Role, ROLE_HOME_PATHS } from '@siseep/shared';
import {
  CalendarRange,
  FileSpreadsheet,
  GraduationCap,
  House,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  School,
  UserRound,
  Users,
  UsersRound,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match only the exact path (for portal homes). */
  end?: boolean;
  /** Also shown in the phone bottom bar (max. 5 items). The rest are in the sidebar / home. */
  mobile?: boolean;
}

const account: NavItem = { to: '/cuenta', label: 'Mi cuenta', icon: UserRound, mobile: true };

/** Menu of each portal. Later stages add their screens here. */
export function navItemsFor(role: Role): NavItem[] {
  const home: NavItem = {
    to: ROLE_HOME_PATHS[role],
    label: 'Inicio',
    icon: House,
    end: true,
    mobile: true,
  };
  if (role === 'ADMIN') {
    return [
      home,
      { to: '/admin/grupos', label: 'Grupos', icon: UsersRound, mobile: true },
      { to: '/admin/alumnos', label: 'Alumnos', icon: GraduationCap, mobile: true },
      { to: '/admin/importar', label: 'Importar', icon: FileSpreadsheet, mobile: true },
      { to: '/admin/ciclos', label: 'Ciclos y periodos', icon: CalendarRange },
      { to: '/admin/usuarios', label: 'Usuarios', icon: Users },
      { to: '/admin/permisos', label: 'Permisos especiales', icon: KeyRound },
      { to: '/admin/escuela', label: 'Escuela', icon: School },
      account,
    ];
  }
  if (role === 'DIRECTOR') {
    return [{ ...home, label: 'Tablero', icon: LayoutDashboard, end: false }, account];
  }
  if (role === 'TEACHER') {
    return [{ ...home, label: 'Mis grupos', icon: UsersRound, end: false }, account];
  }
  return [home, account];
}
