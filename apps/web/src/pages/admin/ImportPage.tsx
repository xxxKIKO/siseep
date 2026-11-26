import {
  FIELD_COLORS,
  FIELD_KEYS,
  FIELD_NAMES,
  type ImportCommitResult,
  type ImportIssue,
  type ImportPreview,
  IMPORT_MAX_BYTES,
} from '@siseep/shared';
import {
  CircleAlert,
  CircleCheck,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useGroups, useImportCommit, useImportPreview, usePeriods } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/dates';
import { COMPONENT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

export function ImportPage() {
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const group = groups.data?.find((g) => g.id === groupId);
  const periods = usePeriods(group?.schoolYearId);
  const openPeriods = (periods.data ?? []).filter((p) => p.status === 'OPEN');
  const [periodId, setPeriodId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useImportPreview();
  const commit = useImportCommit();
  const [result, setResult] = useState<ImportCommitResult | null>(null);

  const selectedPeriod =
    periodId ||
    (group?.currentPeriod?.status === 'OPEN' ? group.currentPeriod.id : openPeriods[0]?.id) ||
    '';

  const reset = () => {
    preview.reset();
    setResult(null);
  };

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('El archivo debe ser un Excel .xlsx.');
      return;
    }
    if (picked.size > IMPORT_MAX_BYTES) {
      toast.error('El archivo pesa más de 15 MB.');
      return;
    }
    setFile(picked);
    reset();
  };

  return (
    <div>
      <PageHeader
        title="Importar Excel"
        description='Carga el Excel "Calificaciones y Boletas" de un grupo. Primero verás una vista previa; nada se guarda hasta que confirmes.'
        back={{ to: '/admin', label: 'Administración' }}
      />
      <Card className="mb-5">
        <CardContent className="grid gap-4 pt-5 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-group">Grupo</Label>
            <Select
              id="import-group"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setPeriodId('');
                reset();
              }}
            >
              <option value="">Elige el grupo…</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.schoolYearName}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-period">Periodo (abierto)</Label>
            <Select
              id="import-period"
              value={selectedPeriod}
              disabled={!group}
              onChange={(e) => {
                setPeriodId(e.target.value);
                reset();
              }}
            >
              {openPeriods.length === 0 ? <option value="">Sin periodos abiertos</option> : null}
              {openPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">Archivo</Label>
            <input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => fileInput.current?.click()}
            >
              <FileSpreadsheet aria-hidden />
              <span className="truncate">{file ? file.name : 'Elegir Excel (.xlsx)'}</span>
            </Button>
          </div>
          <Button
            disabled={!group || !selectedPeriod || !file || preview.isPending}
            onClick={() => file && preview.mutate({ file, groupId, periodId: selectedPeriod })}
          >
            {preview.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <Upload aria-hidden />
            )}
            Ver vista previa
          </Button>
        </CardContent>
      </Card>

      {result ? <CommitResult result={result} /> : null}
      {preview.data && !result ? (
        <PreviewView
          preview={preview.data}
          committing={commit.isPending}
          onCommit={() =>
            commit.mutate(preview.data.previewId, {
              onSuccess: (data) => {
                setResult(data);
                toast.success('Importación terminada.');
              },
            })
          }
        />
      ) : null}
    </div>
  );
}

function PreviewView({
  preview,
  committing,
  onCommit,
}: {
  preview: ImportPreview;
  committing: boolean;
  onCommit: () => void;
}) {
  const { summary } = preview;
  const errors = preview.issues.filter((i) => i.severity === 'error');
  const warnings = preview.issues.filter((i) => i.severity === 'warning');
  const infos = preview.issues.filter((i) => i.severity === 'info');
  const byField = useMemo(
    () =>
      FIELD_KEYS.map((key) => ({
        key,
        activities: preview.activities.filter((a) => a.fieldKey === key),
      })),
    [preview.activities],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Alumnos"
          value={summary.students.total}
          detail={`${summary.students.new} nuevos`}
        />
        <Stat label="Actividades" value={summary.activities} />
        <Stat label="Calificaciones" value={summary.grades} />
        <Stat
          label="Ajustes · Observaciones"
          value={`${summary.adjustments} · ${summary.observations}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revisión</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {errors.length === 0 && warnings.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-800">
              <CircleCheck className="size-5" aria-hidden /> Sin errores ni advertencias.
            </p>
          ) : null}
          <IssueGroup
            issues={errors}
            tone="error"
            title={`${errors.length} errores (no se importan esas celdas)`}
          />
          <IssueGroup
            issues={warnings}
            tone="warning"
            title={`${warnings.length} advertencias (se importan, revísalas)`}
          />
          {infos.length ? (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">
                {infos.length} avisos informativos
              </summary>
              <IssueGroup issues={infos} tone="info" />
            </details>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {byField.map(({ key, activities }) => (
          <Card key={key} className="overflow-hidden">
            <div className="h-1.5" style={{ backgroundColor: FIELD_COLORS[key] }} aria-hidden />
            <div className="p-4">
              <h3 className="mb-2 font-semibold">
                {FIELD_NAMES[key]} <Badge>{activities.length} actividades</Badge>
              </h3>
              <ul className="flex flex-col divide-y divide-border text-sm">
                {activities.map((a) => (
                  <li
                    key={`${a.sheet}-${a.column}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{a.name}</span>{' '}
                      <span className="text-xs text-muted-foreground">
                        {COMPONENT_LABELS[a.component]} ·{' '}
                        {formatDate(`${a.date}T12:00:00Z`, "d 'de' MMM")}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <Badge tone="primary">{a.gradeCount}</Badge>
                      {a.notDeliveredCount ? (
                        <Badge tone="neutral">{a.notDeliveredCount} NE</Badge>
                      ) : null}
                      {a.pendingCount ? (
                        <Badge tone="warning">{a.pendingCount} pendientes</Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        ))}
      </div>

      <div className="sticky bottom-20 z-10 flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between lg:bottom-4">
        <p className="text-sm">
          {preview.canCommit
            ? `Se importará a ${preview.group.name}, ${preview.period.name}. Puedes volver a importar el mismo archivo: no se duplica nada.`
            : 'Hay errores que impiden importar. Corrige el Excel y vuelve a subirlo.'}
        </p>
        <Button size="lg" disabled={!preview.canCommit || committing} onClick={onCommit}>
          {committing ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Confirmar importación
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </Card>
  );
}

const ISSUE_STYLES = {
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: CircleAlert },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: TriangleAlert },
  info: { box: 'border-border bg-muted/50 text-foreground', icon: Info },
} as const;

function IssueGroup({
  issues,
  tone,
  title,
}: {
  issues: ImportIssue[];
  tone: keyof typeof ISSUE_STYLES;
  title?: string;
}) {
  if (issues.length === 0) return null;
  const { box, icon: Icon } = ISSUE_STYLES[tone];
  return (
    <div className={cn('rounded-md border p-3', box)} role={tone === 'error' ? 'alert' : undefined}>
      {title ? (
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4" aria-hidden /> {title}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5 text-sm">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.cell ?? ''}-${index}`}>
            {issue.sheet && issue.cell ? (
              <span className="mr-1 font-mono text-xs opacity-75">
                [{issue.sheet} {issue.cell}]
              </span>
            ) : null}
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommitResult({ result }: { result: ImportCommitResult }) {
  return (
    <Card className="border-emerald-200">
      <CardContent className="flex flex-col gap-3 pt-5">
        <p className="flex items-center gap-2 font-semibold text-emerald-800">
          <CircleCheck className="size-5" aria-hidden /> Importación terminada
        </p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          <li>Alumnos nuevos: {result.studentsCreated}</li>
          <li>Alumnos ya existentes: {result.studentsReused}</li>
          <li>Inscripciones nuevas: {result.enrollmentsCreated}</li>
          <li>
            Actividades: {result.activitiesCreated} nuevas, {result.activitiesUpdated} actualizadas
          </li>
          <li>Calificaciones guardadas: {result.gradesUpserted}</li>
          <li>Alumnos con ajustes u observaciones: {result.periodResultsUpserted}</li>
        </ul>
      </CardContent>
    </Card>
  );
}
