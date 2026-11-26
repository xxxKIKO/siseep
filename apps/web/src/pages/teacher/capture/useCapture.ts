import {
  ErrorCode,
  type GradeConflict,
  type GradeRow,
  type GradeStatus,
  type GradeValue,
  type SaveGradesResult,
} from '@siseep/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, api, errorMessage } from '@/lib/api-client';
import {
  backoffDelay,
  formatGrade,
  loadPending,
  type PendingMap,
  parseScoreInput,
  savePending,
  settlePending,
} from '@/lib/capture';

export interface CaptureRow {
  studentId: string;
  listNumber: number;
  shortName: string;
  fullName: string;
  /** What the input shows. */
  text: string;
  error?: string;
  /** Last value confirmed by the server. */
  saved: GradeValue | null;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

const DEBOUNCE_MS = 2000;

/**
 * State of the capture screen: local rows, pending changes (mirrored in IndexedDB), debounced
 * saves, retries with backoff while offline and 409 conflict handling (server value wins).
 */
export function useCapture(activityId: string, initialRows: GradeRow[]) {
  const [rows, setRows] = useState<CaptureRow[]>(() =>
    initialRows.map((r) => ({
      studentId: r.student.id,
      listNumber: r.student.listNumber,
      shortName: r.student.shortName,
      fullName: r.student.fullName,
      text: formatGrade(r.grade),
      saved: r.grade,
    })),
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const rowsRef = useRef(rows);
  const pendingRef = useRef<PendingMap>({});
  const inFlight = useRef(false);
  const flushAgain = useRef(false);
  const attempt = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const updateRows = useCallback((change: (rows: CaptureRow[]) => CaptureRow[]) => {
    rowsRef.current = change(rowsRef.current);
    setRows(rowsRef.current);
  }, []);

  const setPending = useCallback(
    (next: PendingMap) => {
      pendingRef.current = next;
      setPendingCount(Object.keys(next).length);
      void savePending(activityId, next);
    },
    [activityId],
  );

  const schedule = useCallback((delay: number) => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void flushRef.current(), delay);
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(debounceTimer.current);
    clearTimeout(retryTimer.current);
    if (inFlight.current) {
      flushAgain.current = true;
      return;
    }
    const sent = { ...pendingRef.current };
    const entries = Object.values(sent);
    if (entries.length === 0) return;

    inFlight.current = true;
    setSaveState('saving');
    try {
      const result = await api.put<SaveGradesResult>(`/activities/${activityId}/grades`, {
        grades: entries.map(({ studentId, status, score, expectedUpdatedAt }) => ({
          studentId,
          status,
          score,
          expectedUpdatedAt,
        })),
      });
      attempt.current = 0;
      const next = settlePending(pendingRef.current, sent, result.saved);
      const savedBy = new Map(result.saved.map((g) => [g.studentId, g]));
      updateRows((current) =>
        current.map((row) => {
          const saved = savedBy.get(row.studentId);
          if (!saved) return row;
          const { studentId: _id, ...value } = saved;
          // Normalize what is shown ("8." → "8") unless the teacher kept typing or the
          // input now holds an invalid value (then the error stays visible).
          return next[row.studentId] || row.error
            ? { ...row, saved: value }
            : { ...row, saved: value, text: formatGrade(value) };
        }),
      );
      setPending(next);
      setSaveState(Object.keys(next).length ? 'idle' : 'saved');
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        // No connection: keep everything (already in IndexedDB) and retry later.
        setSaveState('offline');
        const delay = backoffDelay(attempt.current++);
        retryTimer.current = setTimeout(() => void flushRef.current(), delay);
      } else if (error instanceof ApiError && error.code === ErrorCode.GRADE_CONFLICT) {
        const conflicts = (error.details as GradeConflict[] | undefined) ?? [];
        const conflicted = new Map(conflicts.map((c) => [c.studentId, c.current]));
        const next = { ...pendingRef.current };
        for (const { studentId } of conflicts) delete next[studentId];
        updateRows((current) =>
          current.map((row) =>
            conflicted.has(row.studentId)
              ? {
                  ...row,
                  saved: conflicted.get(row.studentId) ?? null,
                  text: formatGrade(conflicted.get(row.studentId) ?? null),
                  error: undefined,
                }
              : row,
          ),
        );
        const names = rowsRef.current
          .filter((r) => conflicted.has(r.studentId))
          .map((r) => r.shortName)
          .join(', ');
        toast.warning(
          `Alguien más cambió la calificación de ${names}. Se muestra el valor actual.`,
        );
        setPending(next);
        setSaveState('idle');
        flushAgain.current = true; // the rest of the batch was not saved
      } else if (error instanceof ApiError && error.code === ErrorCode.INVALID_STUDENTS) {
        const invalid = new Set(
          ((error.details as { studentId: string }[]) ?? []).map((d) => d.studentId),
        );
        const next = Object.fromEntries(
          Object.entries(pendingRef.current).filter(([id]) => !invalid.has(id)),
        );
        toast.error(error.message);
        setPending(next);
        flushAgain.current = true;
      } else {
        setSaveState('error');
        toast.error(errorMessage(error));
      }
    } finally {
      inFlight.current = false;
      if (flushAgain.current) {
        flushAgain.current = false;
        if (Object.keys(pendingRef.current).length) void flushRef.current();
      }
    }
  }, [activityId, setPending, updateRows]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** Records a change for one student and schedules the save. */
  const queue = useCallback(
    (studentId: string, status: GradeStatus, score: number | null) => {
      const row = rowsRef.current.find((r) => r.studentId === studentId);
      if (!row) return;
      const previous = pendingRef.current[studentId];
      const unchanged =
        !previous && row.saved && row.saved.status === status && row.saved.score === score;
      if (unchanged) return;
      setPending({
        ...pendingRef.current,
        [studentId]: {
          studentId,
          status,
          score,
          expectedUpdatedAt: previous ? previous.expectedUpdatedAt : (row.saved?.updatedAt ?? null),
          version: (previous?.version ?? 0) + 1,
        },
      });
      if (saveState !== 'offline') setSaveState('idle');
      schedule(DEBOUNCE_MS);
    },
    [schedule, setPending, saveState],
  );

  const setText = useCallback(
    (studentId: string, text: string) => {
      const parsed = parseScoreInput(text);
      updateRows((current) =>
        current.map((r) =>
          r.studentId === studentId
            ? { ...r, text, error: parsed.kind === 'invalid' ? parsed.message : undefined }
            : r,
        ),
      );
      if (parsed.kind === 'grade') {
        queue(studentId, parsed.status, parsed.score);
      } else if (pendingRef.current[studentId]) {
        // Invalid or empty: forget the change in progress ("1" while typing "14" is not a grade).
        const { [studentId]: _dropped, ...rest } = pendingRef.current;
        setPending(rest);
      }
    },
    [queue, setPending, updateRows],
  );

  const setQuick = useCallback(
    (studentId: string, status: GradeStatus, score: number | null) => {
      updateRows((current) =>
        current.map((r) =>
          r.studentId === studentId
            ? { ...r, text: formatGrade({ status, score }), error: undefined }
            : r,
        ),
      );
      queue(studentId, status, score);
    },
    [queue, updateRows],
  );

  // Restore changes left from a previous visit (offline, closed tab) and send them.
  useEffect(() => {
    let cancelled = false;
    void loadPending(activityId).then((stored) => {
      if (cancelled || Object.keys(stored).length === 0) return;
      updateRows((current) =>
        current.map((r) =>
          stored[r.studentId] ? { ...r, text: formatGrade(stored[r.studentId]!) } : r,
        ),
      );
      pendingRef.current = { ...stored, ...pendingRef.current };
      setPendingCount(Object.keys(pendingRef.current).length);
      void flushRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [activityId, updateRows]);

  // Back online → send right away. Leaving the page → try to send.
  useEffect(() => {
    const onOnline = () => void flushRef.current();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      clearTimeout(debounceTimer.current);
      clearTimeout(retryTimer.current);
    };
  }, []);

  const captured = useMemo(
    () => rows.filter((r) => parseScoreInput(r.text).kind === 'grade').length,
    [rows],
  );

  return {
    rows,
    captured,
    pendingCount,
    saveState,
    setText,
    setQuick,
    flushNow: () => void flushRef.current(),
  };
}
