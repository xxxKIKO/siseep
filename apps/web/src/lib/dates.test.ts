import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dates';

describe('dates', () => {
  it('formats in Spanish in the Mexico City time zone', () => {
    // 02:00 UTC on Dec 5 is still Dec 4 in Colima (UTC-6): no off-by-one day.
    expect(formatDate('2026-12-05T02:00:00Z')).toBe('4 de diciembre de 2026');
  });

  it('formats date and time', () => {
    expect(formatDateTime('2026-11-25T18:30:00Z')).toBe('25 de noviembre de 2026, 12:30 p.m.');
  });
});
