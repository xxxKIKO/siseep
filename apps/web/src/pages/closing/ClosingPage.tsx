import {
  type ClosingIssue,
  FIELD_COLORS,
  FIELD_NAMES,
  type FieldKey,
  NOTE_KIND_LABELS,
  type NoteView,
  type PeriodResultRow,
  type PeriodResultsView,
  type UpdatePeriodResultInput,
} from '@siseep/shared';
import {
  CheckCircle2,
  Eye,
  FileDown,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  Lock,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  downloadPeriodExcel,
  downloadReportCards,
  fetchReportCardPreview,
  usePeriodResults,
  usePeriodTransition,
  useUpdatePeriodResult,
} from '@/api/closing';
import { useGroup } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { FIELD_SHORT_LABELS, PERIOD_STATUS_LABELS, PERIOD_STATUS_TONES } from '@/lib/labels';
import { cn } from '@/lib/utils';

/** Fields with their own observation box on the report card (the rest go in "general"). */
const OBSERVATION_FIELDS: FieldKey[] = ['lenguajes', 'saberes'];
const OVERRIDES = [5, 6, 7, 8, 9, 10];

const one = (value: number | null) => (value === null ? '—' : value.toFixed(1));

/**
 * Period closing of a group: one card per student with calculated → final per field,
 * adjustment with reason, observations, "Ojo en" legend and the period's notes for reference.
 * Teacher: /maestro/grupos/:id/cierre. Admin: /admin/grupos/:id/cierre?periodo=.
 */
export function ClosingPage({
  backTo,
}: {
  backTo: (groupId: string, groupName: string) => { to: string; label: string };
}) {
  const { groupId = '' } = useParams();
  const [params] = useSearchParams();
  const group = useGroup(groupId);
  const periodId = params.get('periodo') ?? group.data?.currentPeriod?.id;
  const results = usePeriodResults(groupId, periodId);
  const transition = usePeriodTransition();
  const [preview, setPreview] = useState<{ title: string; html: string | null } | null>(null);
  const [downloading, setDownloading] = useState<'pdf' | 'docx' | 'xlsx' | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);

  if (group.isLoading || results.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!group.data || !periodId) {
    return (
      <p className="text-sm text-muted-foreground">No encontramos el grupo o no tiene periodos.</p>
    );
  }
  if (results.error || !results.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {results.error instanceof ApiError && results.error.status === 403
          ? 'El cierre del periodo lo hace el maestro titular del grupo.'
          : 'No pudimos cargar los resultados del periodo.'}
      </p>
    );
  }

  const view = results.data;
  const fileBase = `Boletas ${view.group.name} - ${view.period.name}`;
  const locked = view.status === 'CLOSED' || view.status === 'PUBLISHED';
  // Read-only viewers (director) see report cards once the period is CLOSED or PUBLISHED;
  // whoever works on the period sees the draft too.
  const cardsAvailable = locked || view.can.edit || view.can.close;

  const openPreview = async (title: string, studentId?: string) => {
    setPreview({ title, html: null });
    try {
      setPreview({ title, html: await fetchReportCardPreview(groupId, periodId, studentId) });
    } catch (error) {
      setPreview(null);
      toast.error(errorMessage(error));
    }
  };
  const download = async (format: 'pdf' | 'docx' | 'xlsx') => {
    setDownloading(format);
    try {
      if (format === 'xlsx') {
        await downloadPeriodExcel(
          groupId,
          periodId,
          `Concentrado ${view.group.name} - ${view.period.name}.xlsx`,
        );
      } else {
        await downloadReportCards(groupId, periodId, format, `${fileBase}.${format}`);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(null);
    }
  };
  const run = (action: 'review' | 'close') =>
    transition.mutate(
      { periodId, groupId, action },
      {
        onSuccess: () =>
          toast.success(
            action === 'review'
              ? 'Enviado a revisión. Ya no se pueden crear actividades.'
              : 'Periodo cerrado. Las boletas quedaron guardadas.',
          ),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'PERIOD_INCOMPLETE') setIssuesOpen(true);
          toast.error(errorMessage(error));
        },
      },
    );

  return (
    <div>
      <PageHeader
        title={`Cierre · ${view.group.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {view.period.name}
            <Badge tone={PERIOD_STATUS_TONES[view.status]}>
              {PERIOD_STATUS_LABELS[view.status]}
            </Badge>
          </span>
        }
        back={backTo(groupId, view.group.name)}
      />

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 pt-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium">
                {view.progress.withObservations} de {view.progress.total} con observaciones
              </span>
              {view.issues.length ? (
                <button
                  type="button"
                  className="min-h-11 text-sm font-medium text-amber-800 underline-offset-2 hover:underline"
                  onClick={() => setIssuesOpen(true)}
                >
                  {view.issues.length} campos pendientes
                </button>
              ) : !locked ? (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 className="size-4" aria-hidden /> Listo para cerrar
                </span>
              ) : null}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={view.progress.total}
              aria-valuenow={view.progress.withObservations}
              aria-label="Alumnos con observaciones"
            >
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${view.progress.total ? (view.progress.withObservations / view.progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {locked ? (
            <Alert variant="info" className="flex items-start gap-2">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                El periodo está {PERIOD_STATUS_LABELS[view.status].toLowerCase()}: las boletas
                muestran la foto guardada al cerrar. Para cambiar algo, la administración debe
                reabrirlo.
              </span>
            </Alert>
          ) : view.status === 'IN_REVIEW' ? (
            <Alert variant="info">
              En revisión: puedes ajustar calificaciones y escribir observaciones, pero ya no crear
              actividades ni capturar calificaciones.
            </Alert>
          ) : null}

          {!cardsAvailable ? (
            <p className="text-sm text-muted-foreground">
              Las boletas se pueden ver y descargar cuando el periodo esté cerrado.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {cardsAvailable ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void openPreview(`Boletas ${view.group.name}`)}
                >
                  <Eye aria-hidden /> Vista previa
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void download('pdf')}
                  disabled={downloading !== null}
                >
                  {downloading === 'pdf' ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <FileDown aria-hidden />
                  )}
                  Descargar PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void download('docx')}
                  disabled={downloading !== null}
                >
                  {downloading === 'docx' ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <FileText aria-hidden />
                  )}
                  Descargar Word
                </Button>
              </>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void download('xlsx')}
              disabled={downloading !== null}
            >
              {downloading === 'xlsx' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet aria-hidden />
              )}
              Concentrado en Excel
            </Button>
            {view.can.review ? (
              <Button onClick={() => run('review')} disabled={transition.isPending}>
                <Send aria-hidden /> Enviar a revisión
              </Button>
            ) : null}
            {view.can.close ? (
              <Button onClick={() => run('close')} disabled={transition.isPending}>
                <Lock aria-hidden /> Cerrar periodo
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ul className="flex flex-col gap-4">
        {view.rows.map((row) => (
          <li key={row.student.id}>
            <StudentCard
              row={row}
              view={view}
              groupId={groupId}
              periodId={periodId}
              notes={view.notes[row.student.id] ?? []}
              onPreview={
                cardsAvailable
                  ? () => void openPreview(row.student.fullName, row.student.id)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        {preview ? (
          <DialogContent
            title={`Vista previa · ${preview.title}`}
            description={locked ? undefined : 'Borrador: el periodo aún no está cerrado.'}
            className="sm:max-w-4xl"
          >
            {preview.html === null ? (
              <LoaderCircle
                className="mx-auto my-10 size-6 animate-spin text-primary"
                aria-label="Cargando"
              />
            ) : (
              <PreviewFrame html={preview.html} />
            )}
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={issuesOpen} onOpenChange={setIssuesOpen}>
        {issuesOpen ? (
          <DialogContent
            title="Falta información para cerrar"
            description="Captura estas calificaciones (o márcalas como justificadas) antes de cerrar."
          >
            <IssuesList issues={view.issues} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Letter page (8.5 in at 96 dpi) plus margins: scaled down to fit narrow screens. */
const PAGE_PX = 860;

function PreviewFrame({ html }: { html: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(Math.min(1, entry.contentRect.width / PAGE_PX));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="h-[70dvh] overflow-hidden rounded-md border border-border bg-muted">
      <iframe
        title="Vista previa de la boleta"
        srcDoc={html}
        sandbox=""
        style={{
          width: PAGE_PX,
          height: `calc(70dvh / ${scale})`,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      />
    </div>
  );
}

function IssuesList({ issues }: { issues: ClosingIssue[] }) {
  if (issues.length === 0) return <p className="text-sm">No hay pendientes.</p>;
  return (
    <ul className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto text-sm">
      {issues.map((issue) => (
        <li
          key={`${issue.studentId}:${issue.fieldKey}`}
          className="rounded-md border border-border p-2.5"
        >
          <span className="font-medium">
            {issue.listNumber}. {issue.studentName}
          </span>
          <span className="block text-muted-foreground">
            {FIELD_NAMES[issue.fieldKey]} ·{' '}
            {issue.activityIds.length
              ? `${issue.activityIds.length} ${issue.activityIds.length === 1 ? 'actividad sin calificar' : 'actividades sin calificar'}`
              : 'faltan componentes'}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Draft {
  overrides: Partial<Record<FieldKey, { value: string; reason: string }>>;
  byField: Partial<Record<FieldKey, string>>;
  general: string;
  replaceLegend: boolean;
  legend: string;
}

function draftOf(row: PeriodResultRow): Draft {
  return {
    overrides: Object.fromEntries(
      row.fields.map((f) => [
        f.fieldKey,
        { value: f.override === null ? '' : String(f.override), reason: f.overrideReason ?? '' },
      ]),
    ),
    byField: { ...row.observations.byField },
    general: row.observations.general ?? '',
    replaceLegend: row.legendOverride !== null,
    legend: row.legendOverride ?? row.legendSuggested ?? '',
  };
}

function StudentCard({
  row,
  view,
  groupId,
  periodId,
  notes,
  onPreview,
}: {
  row: PeriodResultRow;
  view: PeriodResultsView;
  groupId: string;
  periodId: string;
  notes: NoteView[];
  onPreview?: () => void;
}) {
  const update = useUpdatePeriodResult(groupId, periodId);
  const initial = useMemo(() => draftOf(row), [row]);
  const [draft, setDraft] = useState(initial);
  // New server data (save, close, reopen) resets the form.
  const [loaded, setLoaded] = useState(initial);
  if (loaded !== initial) {
    setLoaded(initial);
    setDraft(initial);
  }
  const editable = view.can.edit && Boolean(row.id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const legend = row.legendOverride ?? row.legendSuggested;

  const save = () => {
    const input: UpdatePeriodResultInput = {
      fields: row.fields.map((f) => {
        const o = draft.overrides[f.fieldKey]!;
        return {
          fieldKey: f.fieldKey,
          override: o.value === '' ? null : Number(o.value),
          overrideReason: o.value === '' ? null : o.reason.trim() || null,
        };
      }),
      observations: {
        general: draft.general.trim() || null,
        byField: Object.fromEntries(
          OBSERVATION_FIELDS.map((key) => [key, draft.byField[key]?.trim() || null]),
        ),
      },
      legendOverride: draft.replaceLegend ? draft.legend.trim() || null : null,
    };
    update.mutate({ id: row.id, input });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">
              <span className="text-muted-foreground">{row.student.listNumber}.</span>{' '}
              {row.student.fullName}
            </h2>
            <p className="text-sm text-muted-foreground">
              Promedio general{' '}
              <strong className="text-base text-foreground">{one(row.generalAverage)}</strong>
              {row.source === 'snapshot' ? ' · foto del cierre' : ''}
            </p>
          </div>
          {onPreview ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPreview}
              aria-label={`Vista previa de la boleta de ${row.student.fullName}`}
            >
              <Eye aria-hidden /> Boleta
            </Button>
          ) : null}
        </div>

        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {row.fields.map((f) => {
            const o = draft.overrides[f.fieldKey] ?? { value: '', reason: '' };
            const id = `${row.student.id}-${f.fieldKey}`;
            return (
              <li key={f.fieldKey} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      className="size-3 rounded-full"
                      style={{ backgroundColor: FIELD_COLORS[f.fieldKey] }}
                      aria-hidden
                    />
                    {FIELD_SHORT_LABELS[f.fieldKey]}
                  </span>
                  <span className="flex items-center gap-2 text-sm tabular-nums">
                    <span
                      className={cn(f.calculated !== null && f.calculated < 6 && 'text-red-700')}
                    >
                      {f.calculated === null ? '—' : f.calculated.toFixed(2)}
                    </span>
                    <span aria-hidden>→</span>
                    <strong className="text-lg">
                      {f.final ?? '—'}
                      {f.adjusted ? '*' : ''}
                    </strong>
                    {f.pending ? <Badge tone="warning">{f.pending} sin calificar</Badge> : null}
                  </span>
                </div>
                {editable ? (
                  <div className="grid gap-2 sm:grid-cols-[9rem_1fr]">
                    <div>
                      <Label htmlFor={`${id}-o`} className="sr-only">
                        Ajuste de {FIELD_NAMES[f.fieldKey]}
                      </Label>
                      <Select
                        id={`${id}-o`}
                        value={o.value}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            overrides: {
                              ...d.overrides,
                              [f.fieldKey]: { ...o, value: e.target.value },
                            },
                          }))
                        }
                      >
                        <option value="">Sin ajuste</option>
                        {OVERRIDES.map((n) => (
                          <option key={n} value={n}>
                            Ajustar a {n}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {o.value !== '' ? (
                      <Input
                        aria-label={`Motivo del ajuste de ${FIELD_NAMES[f.fieldKey]}`}
                        placeholder="Motivo (opcional)"
                        value={o.reason}
                        maxLength={300}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            overrides: {
                              ...d.overrides,
                              [f.fieldKey]: { ...o, reason: e.target.value },
                            },
                          }))
                        }
                      />
                    ) : null}
                  </div>
                ) : f.adjusted && f.overrideReason ? (
                  <p className="text-xs text-muted-foreground">Ajuste: {f.overrideReason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="grid gap-3 lg:grid-cols-3">
          {OBSERVATION_FIELDS.map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`${row.student.id}-obs-${key}`}>{FIELD_NAMES[key]}</Label>
              <Textarea
                id={`${row.student.id}-obs-${key}`}
                value={draft.byField[key] ?? ''}
                disabled={!editable}
                maxLength={1500}
                rows={3}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, byField: { ...d.byField, [key]: e.target.value } }))
                }
              />
            </div>
          ))}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${row.student.id}-obs-general`}>Observación general</Label>
            <Textarea
              id={`${row.student.id}-obs-general`}
              value={draft.general}
              disabled={!editable}
              maxLength={1500}
              rows={3}
              onChange={(e) => setDraft((d) => ({ ...d, general: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">Leyenda: </span>
            <span className={cn('font-medium', legend ? 'text-red-700' : 'text-muted-foreground')}>
              {legend ?? 'Sin leyenda (ningún campo bajo).'}
            </span>
          </p>
          {editable ? (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={draft.replaceLegend}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      replaceLegend: e.target.checked,
                      legend: d.legend || row.legendSuggested || '',
                    }))
                  }
                />
                Reemplazar la leyenda sugerida
              </label>
              {draft.replaceLegend ? (
                <Input
                  aria-label="Leyenda personalizada"
                  value={draft.legend}
                  maxLength={200}
                  placeholder="Ojo en: …"
                  onChange={(e) => setDraft((d) => ({ ...d, legend: e.target.value }))}
                />
              ) : null}
            </>
          ) : null}
        </div>

        {notes.length ? (
          <details className="rounded-md bg-muted/50 p-3 text-sm">
            <summary className="flex min-h-8 cursor-pointer items-center font-medium">
              Notas del periodo ({notes.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {notes.map((note) => (
                <li key={note.id}>
                  <span className="text-muted-foreground">
                    {formatDate(note.date)} · {NOTE_KIND_LABELS[note.kind]}
                    {note.fieldKey ? ` · ${FIELD_SHORT_LABELS[note.fieldKey]}` : ''}:
                  </span>{' '}
                  {note.text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {editable ? (
          <div className="flex justify-end gap-2">
            {dirty ? (
              <Button variant="ghost" onClick={() => setDraft(initial)} disabled={update.isPending}>
                Descartar
              </Button>
            ) : null}
            <Button onClick={save} disabled={!dirty || update.isPending}>
              {update.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Guardar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
