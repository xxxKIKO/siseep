import type { Component, EnrollmentStatus, PeriodStatus, SubjectKey } from '@siseep/shared';

export const COMPONENT_LABELS: Record<Component, string> = {
  DESEMPENO: 'Desempeño',
  PROYECTO: 'Proyectos',
  EXAMEN: 'Exámenes',
  COMPLEMENTARIA: 'Complementaria',
};

export const SUBJECT_LABELS: Record<SubjectKey, string> = {
  ingles: 'Inglés',
  ed_fisica: 'Educación Física',
};

export const PERIOD_STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: 'Abierto',
  IN_REVIEW: 'En revisión',
  CLOSED: 'Cerrado',
  PUBLISHED: 'Publicado',
};

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ACTIVE: 'Activo',
  TRANSFERRED: 'Cambio de escuela',
  WITHDRAWN: 'Baja',
};

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  INVITED: 'Invitada',
  DISABLED: 'Desactivada',
};

/** Today's date (device time) as `YYYY-MM-DD`, to prefill date inputs. */
export function todayDateOnly(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
