import { LoaderCircle } from 'lucide-react';
import { useStudentSummary } from '@/api/summary';
import { formatAverage, gradeTone } from '@/components/summary/grade-style';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const BAR_TONES = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  ok: 'bg-primary',
  none: 'bg-muted',
} as const;

/** Student file: one 0-10 bar per field with the live average and the would-be report card. */
export function StudentSummaryBars({
  studentId,
  periodId,
}: {
  studentId: string;
  periodId?: string;
}) {
  const summary = useStudentSummary(studentId, periodId);
  if (summary.isLoading)
    return (
      <LoaderCircle className="mx-auto size-5 animate-spin text-primary" aria-label="Cargando" />
    );
  if (!summary.data) return null;
  const { result, fields } = summary.data;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Resumen</h2>
        <span className="text-sm text-muted-foreground">
          Promedio general{' '}
          <strong className="text-lg text-foreground">
            {formatAverage(result.generalAverage)}
          </strong>
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {result.fields.map((field) => {
          const meta = fields.find((f) => f.key === field.fieldKey)!;
          const tone = gradeTone(field.calculated);
          const width =
            field.calculated === null ? 0 : Math.max(0, Math.min(100, field.calculated * 10));
          return (
            <li key={field.fieldKey}>
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: meta.color }}
                    aria-hidden
                  />
                  <span className="truncate font-medium">{meta.name}</span>
                  {field.partial ? <span className="text-xs text-amber-800">parcial</span> : null}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatAverage(field.calculated)}
                  {field.final !== null ? (
                    <span className="ml-1 font-semibold">
                      → {field.final}
                      {field.adjusted ? '*' : ''}
                    </span>
                  ) : null}
                </span>
              </div>
              <div
                className="h-2.5 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={field.calculated ?? 0}
                aria-label={`${meta.name}: ${formatAverage(field.calculated)}`}
              >
                <div
                  className={cn('h-full rounded-full', BAR_TONES[tone])}
                  style={{ width: `${width}%` }}
                />
              </div>
              {field.pending ? (
                <p className="mt-1 text-xs text-amber-800">
                  {field.pending} calificaciones pendientes
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {result.legendSuggested ? (
        <p className="mt-3 text-sm font-medium text-red-800">{result.legendSuggested}</p>
      ) : null}
    </Card>
  );
}
