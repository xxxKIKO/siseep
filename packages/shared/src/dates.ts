/**
 * Calendar dates (no time of day) travel as `YYYY-MM-DD` strings and are stored as 12:00 UTC of
 * that day. Noon UTC is the same calendar day in every Mexican time zone, so a date never shifts
 * by one when shown in America/Mexico_City.
 */
export const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function dateOnlyToDate(value: string): Date {
  if (!DATE_ONLY_REGEX.test(value)) throw new Error(`Fecha inválida: ${value}`);
  return new Date(`${value}T12:00:00.000Z`);
}

export function dateToDateOnly(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}
