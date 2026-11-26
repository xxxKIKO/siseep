import type { RosterEntry } from '@siseep/shared';
import { LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ENROLLMENT_STATUS_LABELS } from '@/lib/labels';

/** The group's list in N/L order, compact enough for a 360 px screen. */
export function RosterList({
  entries,
  loading,
}: {
  entries: RosterEntry[] | undefined;
  loading?: boolean;
}) {
  if (loading)
    return (
      <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
    );
  if (!entries?.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Aún no hay alumnos inscritos.
      </p>
    );
  }
  return (
    <ol
      className="flex flex-col divide-y divide-border"
      aria-label="Lista del grupo por número de lista"
    >
      {entries.map((entry) => (
        <li key={entry.enrollmentId} className="flex min-h-11 items-center gap-3 py-2">
          <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {entry.listNumber}
          </span>
          <span
            className={`min-w-0 flex-1 truncate ${entry.status === 'ACTIVE' ? '' : 'text-muted-foreground line-through'}`}
          >
            {entry.student.fullName}
          </span>
          {entry.status !== 'ACTIVE' ? (
            <Badge>{ENROLLMENT_STATUS_LABELS[entry.status]}</Badge>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
