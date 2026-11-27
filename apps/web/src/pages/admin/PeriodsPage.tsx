import { type PeriodGroupStatusView, reopenPeriodSchema } from '@siseep/shared';
import { ClipboardCheck, FileSpreadsheet, LoaderCircle, Lock, RotateCcw, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { usePortalBase } from '@/auth/ability';
import { downloadPeriodExcel, usePeriodGroupStatuses, usePeriodTransition } from '@/api/closing';
import { usePeriods, useSchoolYears } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/dates';
import { PERIOD_STATUS_LABELS, PERIOD_STATUS_TONES } from '@/lib/labels';

/** /admin/periodos — status of each group per period, with close, publish and reopen. */
export function PeriodsPage() {
  const base = usePortalBase();
  const years = useSchoolYears();
  const [yearId, setYearId] = useState('');
  const currentYear = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];
  const selectedYear = yearId || currentYear?.id || '';
  const periods = usePeriods(selectedYear || undefined);
  const [periodId, setPeriodId] = useState('');
  const selectedPeriod = periodId || periods.data?.[0]?.id || '';
  const statuses = usePeriodGroupStatuses(selectedPeriod || undefined);
  const transition = usePeriodTransition();
  const [reopening, setReopening] = useState<PeriodGroupStatusView | null>(null);

  const run = (row: PeriodGroupStatusView, action: 'close' | 'publish') =>
    transition.mutate(
      { periodId: row.periodId, groupId: row.groupId, action },
      {
        onSuccess: () =>
          toast.success(
            action === 'close'
              ? `Periodo cerrado en ${row.groupName}.`
              : `Boletas de ${row.groupName} publicadas.`,
          ),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'PERIOD_INCOMPLETE') {
            const count = Array.isArray(error.details) ? error.details.length : 0;
            toast.error(
              `No se puede cerrar ${row.groupName}: ${count} campos con calificaciones pendientes. Revisa el cierre del grupo.`,
            );
          } else {
            toast.error(errorMessage(error));
          }
        },
      },
    );

  return (
    <div>
      <PageHeader
        title="Periodos"
        description="Estado del periodo en cada grupo: revisión, cierre y publicación de boletas."
        back={{ to: base, label: base === '/director' ? 'Tablero' : 'Administración' }}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="year">Ciclo escolar</Label>
          <Select
            id="year"
            value={selectedYear}
            onChange={(e) => {
              setYearId(e.target.value);
              setPeriodId('');
            }}
          >
            {(years.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="period">Periodo</Label>
          <Select id="period" value={selectedPeriod} onChange={(e) => setPeriodId(e.target.value)}>
            {(periods.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {statuses.isLoading ? (
        <LoaderCircle
          className="mx-auto mt-10 size-6 animate-spin text-primary"
          aria-label="Cargando"
        />
      ) : !statuses.data?.length ? (
        <p className="text-sm text-muted-foreground">No hay grupos en este ciclo.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {statuses.data.map((row) => (
            <li key={row.groupId}>
              <Card>
                <CardContent className="flex flex-col gap-3 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">{row.groupName}</h2>
                      <p className="text-sm text-muted-foreground">
                        {row.homeroomTeacher ?? 'Sin maestro titular'} · {row.studentCount} alumnos
                      </p>
                    </div>
                    <Badge tone={PERIOD_STATUS_TONES[row.status]}>
                      {PERIOD_STATUS_LABELS[row.status]}
                    </Badge>
                  </div>
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    {row.reviewRequestedAt && row.status === 'IN_REVIEW' ? (
                      <div>
                        <dt className="inline">Enviado a revisión: </dt>
                        <dd className="inline">{formatDateTime(row.reviewRequestedAt)}</dd>
                      </div>
                    ) : null}
                    {row.closedAt ? (
                      <div>
                        <dt className="inline">Cerrado: </dt>
                        <dd className="inline">{formatDateTime(row.closedAt)}</dd>
                      </div>
                    ) : null}
                    {row.publishedAt ? (
                      <div>
                        <dt className="inline">Publicado: </dt>
                        <dd className="inline">{formatDateTime(row.publishedAt)}</dd>
                      </div>
                    ) : null}
                    {row.reopenedAt ? (
                      <div>
                        <dt className="inline">Reabierto: </dt>
                        <dd className="inline">
                          {formatDateTime(row.reopenedAt)}
                          {row.reopenReason ? ` · “${row.reopenReason}”` : ''}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`${base}/grupos/${row.groupId}/cierre?periodo=${row.periodId}`}>
                        <ClipboardCheck aria-hidden /> Ver cierre
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void downloadPeriodExcel(
                          row.groupId,
                          row.periodId,
                          `Concentrado ${row.groupName}.xlsx`,
                        ).catch((error: unknown) => toast.error(errorMessage(error)))
                      }
                    >
                      <FileSpreadsheet aria-hidden /> Excel
                    </Button>
                    {row.status === 'OPEN' || row.status === 'IN_REVIEW' ? (
                      <Button
                        size="sm"
                        onClick={() => run(row, 'close')}
                        disabled={transition.isPending}
                      >
                        <Lock aria-hidden /> Cerrar
                      </Button>
                    ) : null}
                    {row.status === 'CLOSED' ? (
                      <Button
                        size="sm"
                        onClick={() => run(row, 'publish')}
                        disabled={transition.isPending}
                      >
                        <Send aria-hidden /> Publicar
                      </Button>
                    ) : null}
                    {row.status !== 'OPEN' ? (
                      <Button variant="outline" size="sm" onClick={() => setReopening(row)}>
                        <RotateCcw aria-hidden /> Reabrir
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={reopening !== null} onOpenChange={(open) => !open && setReopening(null)}>
        {reopening ? (
          <ReopenDialog
            row={reopening}
            pending={transition.isPending}
            onConfirm={(reason) =>
              transition.mutate(
                {
                  periodId: reopening.periodId,
                  groupId: reopening.groupId,
                  action: 'reopen',
                  reason,
                },
                {
                  onSuccess: () => {
                    toast.success(`Periodo reabierto en ${reopening.groupName}.`);
                    setReopening(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
            }
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function ReopenDialog({
  row,
  pending,
  onConfirm,
}: {
  row: PeriodGroupStatusView;
  pending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogContent
      title={`Reabrir ${row.groupName}`}
      description="El grupo vuelve a estar abierto: se conservan ajustes y observaciones, y las boletas se recalculan al volver a cerrar."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = reopenPeriodSchema.safeParse({ reason });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message ?? 'Escribe el motivo');
            return;
          }
          onConfirm(parsed.data.reason);
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reopen-reason">Motivo</Label>
          <Textarea
            id="reopen-reason"
            value={reason}
            maxLength={500}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'reopen-error' : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
          {error ? (
            <p id="reopen-error" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <RotateCcw aria-hidden />
          )}
          Reabrir periodo
        </Button>
      </form>
    </DialogContent>
  );
}
