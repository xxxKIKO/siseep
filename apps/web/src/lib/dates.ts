import { TZDate } from '@date-fns/tz';
import { format as formatFn } from 'date-fns';
import { es } from 'date-fns/locale';

/** Every date in the UI is shown in Colima's time zone, whatever the device's setting. */
export const SCHOOL_TIME_ZONE = 'America/Mexico_City';

/** Formats an ISO string or Date in the school's time zone, in Spanish. */
export function formatDate(value: string | Date, pattern = "d 'de' MMMM 'de' yyyy"): string {
  const date = new TZDate(new Date(value), SCHOOL_TIME_ZONE);
  return formatFn(date, pattern, { locale: es });
}

export function formatDateTime(value: string | Date): string {
  return formatDate(value, "d 'de' MMMM 'de' yyyy, h:mm aaaa");
}
