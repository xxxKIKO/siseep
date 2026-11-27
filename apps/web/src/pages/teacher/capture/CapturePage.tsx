import { FIELD_COLORS, FIELD_NAMES, type ActivityGradesView } from '@siseep/shared';
import { CircleCheck, CloudOff, FileDown, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useBlocker, useParams } from 'react-router';
import { downloadCaptureSheet, useActivityGrades } from '@/api/capture';
import { useCan, usePortalBase } from '@/auth/ability';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/dates';
import { COMPONENT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { type SaveState, useCapture } from './useCapture';

/** /maestro/actividades/:activityId — capture the whole list with one hand. */
export function CapturePage() {
  const { activityId = '' } = useParams();
  const grades = useActivityGrades(activityId);

  if (grades.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!grades.data) {
    return (
      <p className="text-sm text-muted-foreground">
        No encontramos la actividad o no tienes acceso.
      </p>
    );
  }
  return <CaptureEditor key={activityId} view={grades.data} />;
}

function SaveIndicator({ state, pending }: { state: SaveState; pending: number }) {
  if (state === 'offline') {
    return (
      <span className="flex items-center gap-1.5 text-amber-800" role="status">
        <CloudOff className="size-4" aria-hidden /> Sin conexión: {pending}{' '}
        {pending === 1 ? 'cambio' : 'cambios'} por enviar
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Guardando…
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-destructive" role="status">
        <TriangleAlert className="size-4" aria-hidden /> No se pudo guardar
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className="text-muted-foreground" role="status">
        Cambios sin guardar…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-emerald-700" role="status">
        <CircleCheck className="size-4" aria-hidden /> Guardado
      </span>
    );
  }
  return <span role="status" />;
}

function CaptureEditor({ view }: { view: ActivityGradesView }) {
  const { activity } = view;
  const { rows, captured, pendingCount, saveState, setText, setQuick, flushNow } = useCapture(
    activity.id,
    view.rows,
  );
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const { can, ready } = useCan();
  const base = usePortalBase();
  // Editable only with an OPEN period and the CASL permission (a director needs a grant).
  const readOnly =
    view.periodStatus !== 'OPEN' ||
    !ready ||
    !can('update', 'Grade', {
      groupId: activity.groupId,
      ...(activity.subjectKey ? { subjectKey: activity.subjectKey } : {}),
    });

  // Warn before leaving with unsent changes (in-app navigation and closing the tab).
  const blocker = useBlocker(pendingCount > 0);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (
      window.confirm(
        'Hay calificaciones sin guardar. ¿Salir de todos modos? Se enviarán al volver.',
      )
    ) {
      blocker.proceed();
    } else {
      blocker.reset();
      flushNow();
    }
  }, [blocker, flushNow]);
  useEffect(() => {
    if (pendingCount === 0) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pendingCount]);

  const focusRow = (index: number) => {
    const next = inputs.current[index];
    if (next) {
      next.focus();
      next.select();
    } else {
      inputs.current[index - 1]?.blur();
    }
  };

  return (
    <div>
      <PageHeader
        title={activity.name}
        back={{
          to: `${base}/grupos/${activity.groupId}?campo=${activity.fieldKey}`,
          label: `Grupo ${view.groupName}`,
        }}
        description={`${FIELD_NAMES[activity.fieldKey]} · ${COMPONENT_LABELS[activity.component]} · ${formatDate(`${activity.date}T12:00:00Z`, "d 'de' MMMM")}`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void downloadCaptureSheet(activity.groupId, activity)}
          >
            <FileDown aria-hidden /> Hoja de captura
          </Button>
        }
      />

      {/* Sticky summary: always visible while scrolling the list. */}
      <div className="sticky top-[57px] z-10 -mx-4 mb-3 border-y border-border bg-card/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:rounded-lg lg:border">
        <div
          className="h-1 rounded-full"
          style={{ backgroundColor: FIELD_COLORS[activity.fieldKey] }}
          aria-hidden
        />
        <div className="mt-2 flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold tabular-nums" aria-live="polite">
            {captured} de {rows.length} capturados
          </span>
          <SaveIndicator state={saveState} pending={pendingCount} />
        </div>
      </div>

      {readOnly ? (
        <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm">
          El periodo ya no está abierto: las calificaciones son de solo lectura.
        </p>
      ) : null}

      <ol
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card"
        aria-label="Captura por número de lista"
      >
        {rows.map((row, index) => {
          const filled = row.text.trim() !== '' && !row.error;
          return (
            <li
              key={row.studentId}
              className={cn(
                'flex items-center gap-2 px-2 py-2 sm:px-3',
                !filled && !readOnly && 'bg-amber-50/40',
              )}
            >
              <span className="w-6 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
                {row.listNumber}
              </span>
              <label
                htmlFor={`grade-${row.studentId}`}
                className="line-clamp-2 min-w-0 flex-1 text-sm leading-tight"
                title={row.fullName}
              >
                {row.shortName}
              </label>
              <div className="flex shrink-0 flex-col items-end">
                <input
                  ref={(el) => {
                    inputs.current[index] = el;
                  }}
                  id={`grade-${row.studentId}`}
                  type="text"
                  inputMode="decimal"
                  enterKeyHint={index === rows.length - 1 ? 'done' : 'next'}
                  autoComplete="off"
                  maxLength={4}
                  disabled={readOnly}
                  value={row.text}
                  aria-invalid={row.error ? true : undefined}
                  aria-describedby={row.error ? `grade-error-${row.studentId}` : undefined}
                  aria-label={`Calificación de ${row.fullName}`}
                  className={cn(
                    'h-12 w-16 rounded-md border border-input bg-card text-center text-xl font-semibold tabular-nums',
                    row.error && 'border-destructive bg-red-50 text-destructive',
                  )}
                  onChange={(e) => setText(row.studentId, e.target.value)}
                  onBlur={(e) => {
                    // Moving to the next student keeps the 2 s debounce; leaving the list saves now.
                    const next = e.relatedTarget as HTMLElement | null;
                    if (!next?.id?.startsWith('grade-')) flushNow();
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      focusRow(index + 1);
                    }
                  }}
                />
              </div>
              <div
                className="flex shrink-0 gap-1"
                role="group"
                aria-label={`Atajos para ${row.shortName}`}
              >
                {(
                  [
                    ['NE', 'NOT_DELIVERED', 0, 'No entregó'],
                    ['NA', 'EXCUSED', null, 'No aplica'],
                    ['10', 'SCORED', 10, 'Diez'],
                  ] as const
                ).map(([label, status, score, title]) => (
                  <button
                    key={label}
                    type="button"
                    disabled={readOnly}
                    title={title}
                    aria-label={`${title}: ${row.shortName}`}
                    className="flex size-11 items-center justify-center rounded-md border border-border bg-muted/60 text-xs font-semibold text-foreground active:bg-primary active:text-primary-foreground disabled:opacity-50"
                    onClick={() => setQuick(row.studentId, status, score)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {row.error ? (
                <span id={`grade-error-${row.studentId}`} className="sr-only">
                  {row.error}
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {rows.some((r) => r.error) ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {rows
            .filter((r) => r.error)
            .map((r) => `${r.shortName}: ${r.error}`)
            .join(' · ')}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        NE = no entregó (cuenta como 0) · NA = no aplica (no cuenta). Se guarda solo a los 2
        segundos o al cambiar de alumno; sin señal, los cambios esperan en el celular.
      </p>
    </div>
  );
}
