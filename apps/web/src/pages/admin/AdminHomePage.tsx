import {
  CalendarRange,
  ClipboardCheck,
  FileSpreadsheet,
  GraduationCap,
  KeyRound,
  type LucideIcon,
  School,
  Users,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { Card } from '@/components/ui/card';

const SECTIONS: { to: string; title: string; description: string; icon: LucideIcon }[] = [
  {
    to: '/admin/grupos',
    title: 'Grupos',
    description: 'Crear grupos y asignar maestros',
    icon: UsersRound,
  },
  {
    to: '/admin/alumnos',
    title: 'Alumnos',
    description: 'Alta, búsqueda e inscripción con N/L',
    icon: GraduationCap,
  },
  {
    to: '/admin/importar',
    title: 'Importar Excel',
    description: 'Cargar el Excel de calificaciones de un grupo',
    icon: FileSpreadsheet,
  },
  {
    to: '/admin/ciclos',
    title: 'Ciclos y periodos',
    description: 'Ciclos escolares, periodos y reglas de cálculo',
    icon: CalendarRange,
  },
  {
    to: '/admin/periodos',
    title: 'Cierre de periodos',
    description: 'Estado de cada grupo: cerrar, publicar y reabrir',
    icon: ClipboardCheck,
  },
  {
    to: '/admin/usuarios',
    title: 'Usuarios',
    description: 'Invitar personal, roles y accesos',
    icon: Users,
  },
  {
    to: '/admin/permisos',
    title: 'Permisos especiales',
    description: 'Permisos de edición puntuales',
    icon: KeyRound,
  },
  {
    to: '/admin/escuela',
    title: 'Escuela',
    description: 'Datos y logo de la escuela',
    icon: School,
  },
];

export function AdminHomePage() {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Administración</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user ? `, ${user.firstName}` : ''}
        </h1>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <Link to={section.to} className="block h-full rounded-lg focus-visible:outline-2">
              <Card className="flex h-full items-start gap-3 p-4 transition-colors hover:bg-muted/50">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
                  <section.icon className="size-5 text-primary" aria-hidden />
                </span>
                <span>
                  <span className="block font-semibold">{section.title}</span>
                  <span className="block text-sm text-muted-foreground">{section.description}</span>
                </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
