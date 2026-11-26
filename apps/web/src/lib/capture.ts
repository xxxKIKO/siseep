import type { GradeStatus } from '@siseep/shared';
import { del, get, set } from 'idb-keyval';

// ---------------------------------------------------------------------------
// What the teacher types
// ---------------------------------------------------------------------------
export type ParsedInput =
  | { kind: 'empty' }
  | { kind: 'grade'; status: GradeStatus; score: number | null }
  | { kind: 'invalid'; message: string };

/**
 * Reads the capture input: 0-10 with at most one decimal (comma or dot), or NE / NA.
 * "14" or "8.55" are rejected while typing (section 6: the 14 of the Excel can't be captured).
 */
export function parseScoreInput(raw: string): ParsedInput {
  const text = raw.trim().toUpperCase();
  if (text === '') return { kind: 'empty' };
  if (text === 'NE') return { kind: 'grade', status: 'NOT_DELIVERED', score: 0 };
  if (text === 'NA') return { kind: 'grade', status: 'EXCUSED', score: null };
  if (!/^\d{1,2}([.,]\d*)?$/.test(text))
    return { kind: 'invalid', message: 'Escribe un número de 0 a 10' };
  const [, decimals = ''] = text.split(/[.,]/);
  if (decimals.length > 1) return { kind: 'invalid', message: 'Máximo un decimal' };
  const value = Number(text.replace(',', '.'));
  if (Number.isNaN(value) || value < 0 || value > 10)
    return { kind: 'invalid', message: 'Va de 0 a 10' };
  return value === 0
    ? { kind: 'grade', status: 'NOT_DELIVERED', score: 0 }
    : { kind: 'grade', status: 'SCORED', score: value };
}

/** How a stored grade is shown in the input. */
export function formatGrade(grade: { status: GradeStatus; score: number | null } | null): string {
  if (!grade) return '';
  if (grade.status === 'NOT_DELIVERED') return 'NE';
  if (grade.status === 'EXCUSED') return 'NA';
  return grade.score === null ? '' : String(grade.score);
}

// ---------------------------------------------------------------------------
// Pending changes (offline queue)
// ---------------------------------------------------------------------------
export interface PendingChange {
  studentId: string;
  status: GradeStatus;
  score: number | null;
  /** Version of the grade the teacher saw when editing (null = there was no grade). */
  expectedUpdatedAt: string | null;
  /** Increases on every edit, to know if it changed while a save was in flight. */
  version: number;
}

export type PendingMap = Record<string, PendingChange>;

const storageKey = (activityId: string) => `siseep:capture:${activityId}`;

/** Pending changes survive reloads and closing the browser (IndexedDB). */
export async function loadPending(activityId: string): Promise<PendingMap> {
  try {
    return ((await get<PendingMap>(storageKey(activityId))) ?? {}) as PendingMap;
  } catch {
    return {};
  }
}

export async function savePending(activityId: string, pending: PendingMap): Promise<void> {
  try {
    if (Object.keys(pending).length === 0) await del(storageKey(activityId));
    else await set(storageKey(activityId), pending);
  } catch {
    // Private mode without IndexedDB: changes stay in memory only.
  }
}

/** Retry delay after a failed save: 2 s, 4 s, 8 s … up to 1 minute. */
export function backoffDelay(attempt: number): number {
  return Math.min(60_000, 2000 * 2 ** Math.max(0, attempt));
}

/**
 * After a save: drop what was saved unless it was edited again meanwhile; edits made during the
 * request keep pending but now expect the version just saved.
 */
export function settlePending(
  pending: PendingMap,
  sent: PendingMap,
  saved: { studentId: string; updatedAt: string }[],
): PendingMap {
  const next: PendingMap = { ...pending };
  for (const { studentId, updatedAt } of saved) {
    const current = next[studentId];
    if (!current) continue;
    if (current.version === sent[studentId]?.version) delete next[studentId];
    else next[studentId] = { ...current, expectedUpdatedAt: updatedAt };
  }
  return next;
}
