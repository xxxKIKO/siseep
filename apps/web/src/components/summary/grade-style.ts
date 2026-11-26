/** Red below 6, amber below the "Ojo en" threshold (7), neutral otherwise (section 6 / stage 3). */
export function gradeTone(
  value: number | null | undefined,
  threshold = 7,
): 'red' | 'amber' | 'ok' | 'none' {
  if (value === null || value === undefined) return 'none';
  if (value < 6) return 'red';
  if (value < threshold) return 'amber';
  return 'ok';
}

export const TONE_CLASSES = {
  red: 'border-red-300 bg-red-50 text-red-900',
  amber: 'border-amber-300 bg-amber-50 text-amber-900',
  ok: 'border-border bg-card text-foreground',
  none: 'border-dashed border-border bg-muted/40 text-muted-foreground',
} as const;

/** One decimal for live averages ("8.6"); a dash when there is no data. */
export function formatAverage(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toFixed(1);
}
