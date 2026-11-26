import type { FieldKey, Role } from './enums';

/** Primary brand color (navy blue) used in the UI and report cards. */
export const PRIMARY_COLOR = '#1F3A7A';

/** Colors per formative field (section 5 of docs/plan.md). */
export const FIELD_COLORS: Record<FieldKey, string> = {
  lenguajes: '#F8CBAD',
  saberes: '#9BC2E6',
  etica: '#A9D08E',
  humano: '#B4A7D6',
};

export const FIELD_NAMES: Record<FieldKey, string> = {
  lenguajes: 'Lenguajes',
  saberes: 'Saberes y pensamiento científico',
  etica: 'Ética, naturaleza y sociedades',
  humano: 'De lo humano y lo comunitario',
};

/** Short field names, as the Excel writes them in "Ojo en" ("Saberes, Ética"). */
export const FIELD_SHORT_NAMES: Record<FieldKey, string> = {
  lenguajes: 'Lenguajes',
  saberes: 'Saberes',
  etica: 'Ética',
  humano: 'De lo humano',
};

/** Spanish UI labels for each role. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administración',
  DIRECTOR: 'Dirección',
  TEACHER: 'Docente',
  GUARDIAN: 'Madre, padre o tutor',
};

/** Web route prefix for each role's portal. */
export const ROLE_HOME_PATHS: Record<Role, string> = {
  ADMIN: '/admin',
  DIRECTOR: '/director',
  TEACHER: '/maestro',
  GUARDIAN: '/padres',
};
