import { FIELD_COLORS, FIELD_SHORT_NAMES, type GroupOverview } from '@siseep/shared';
import { ChevronRight, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useDashboard } from '@/api/summary';
import { useAuth } from '@/auth/auth-context';
import { formatAverage, gradeTone, TONE_CLASSES } from '@/components/summary/grade-style';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** /director — every group: capture progress, averages per field and students with alerts. */
export function DirectorDashboardPage() {
  const { user } = useAuth();
  const dashboard = useDashboard();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Dirección</p>
        <h1 className="text-2xl font-semibold tracking-tight">Tablero de la escuela</h1>
        <p className="text-sm text-muted-foreground">
          Hola{user ? `, ${user.firstName}` : ''}. Toca un grupo para ver su resumen.
        </p>
      </div>
      {dashboard.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : dashboard.data?.length ? (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.data.map((row) => (
            <li key={row.group.id}>
              <GroupCard row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <Card className="px-5 py-10 text-center text-sm text-muted-foreground">
          Aún no hay grupos en el ciclo actual.
        </Card>
      )}
    </div>
  );
}

function GroupCard({ row }: { row: GroupOverview }) {
  const percent = row.capture?.percent ?? 0;
  return (
    <Link to={`/director/grupos/${row.group.id}/resumen`} className="block h-full rounded-lg">
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:bg-muted/40">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-lg font-semibold">Grupo {row.group.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {row.group.homeroomTeacher ?? 'Sin titular'} · {row.studentCount} alumnos
            </p>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </div>

        {row.capture ? (
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>
                Captura · {row.capture.activities} actividades
                {row.period ? ` · ${row.period.name}` : ''}
              </span>
              <span className="font-semibold text-foreground">{percent.toFixed(0)}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Avance de captura del grupo ${row.group.name}`}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, percent)}%` }}
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {row.period ? 'Sin datos de captura.' : 'Sin periodo actual.'}
          </p>
        )}

        {row.byField.length ? (
          <div className="grid grid-cols-4 gap-1.5">
            {row.byField.map((f) => (
              <div
                key={f.fieldKey}
                className={cn(
                  'rounded-md border px-1.5 py-1 text-center',
                  TONE_CLASSES[gradeTone(f.average)],
                )}
                title={FIELD_SHORT_NAMES[f.fieldKey]}
              >
                <span
                  className="mx-auto mb-0.5 block h-1 w-6 rounded-full"
                  style={{ backgroundColor: FIELD_COLORS[f.fieldKey] }}
                  aria-hidden
                />
                <span className="block truncate text-[10px] leading-tight">
                  {FIELD_SHORT_NAMES[f.fieldKey]}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatAverage(f.average)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 text-xs">
          {row.studentsWithAlerts ? (
            <Badge tone="danger">
              <TriangleAlert className="size-3" aria-hidden /> {row.studentsWithAlerts} alumnos con
              alertas
            </Badge>
          ) : (
            <Badge tone="success">Sin alumnos bajo 7</Badge>
          )}
          {row.alertCounts.PENDING ? (
            <Badge tone="warning">{row.alertCounts.PENDING} pendientes</Badge>
          ) : null}
          {row.generalAverage !== null ? (
            <Badge>Promedio {row.generalAverage.toFixed(1)}</Badge>
          ) : null}
        </div>
      </Card>
    </Link>
  );
}
