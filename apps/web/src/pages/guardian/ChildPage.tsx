import {
  type ChildActivity,
  type ChildOverview,
  FIELD_COLORS,
  FIELD_NAMES,
  FIELD_SHORT_NAMES,
  NOTE_KIND_LABELS,
} from '@siseep/shared';
import { FileDown, Heart, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import {
  downloadChildReportCard,
  useChildActivities,
  useChildNotes,
  useChildOverview,
  useChildren,
  useChildReportCards,
} from '@/api/guardian';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { COMPONENT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'avance', label: 'Avance' },
  { key: 'actividades', label: 'Actividades' },
  { key: 'notas', label: 'Notas de la maestra' },
  { key: 'boletas', label: 'Boletas' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Darker versions of the field colors so the lines are readable on white. */
const LINE_COLORS: Record<string, string> = {
  lenguajes: '#D9773F',
  saberes: '#3C7DBF',
  etica: '#5E9E3C',
  humano: '#7A63B8',
};

function gradeLabel(grade: ChildActivity['grade']): { text: string; tone: string } {
  if (!grade) return { text: 'Sin calificar', tone: 'text-muted-foreground' };
  if (grade.status === 'NOT_DELIVERED') return { text: 'No entregado', tone: 'text-red-700' };
  if (grade.status === 'EXCUSED') return { text: 'Justificado', tone: 'text-muted-foreground' };
  const score = grade.score ?? 0;
  return {
    text: Number.isInteger(score) ? String(score) : score.toFixed(1),
    tone: score < 6 ? 'text-red-700' : score < 7 ? 'text-amber-700' : 'text-foreground',
  };
}

/** /padres/hijos/:studentId — progress, activities, notes and published report cards. */
export function ChildPage() {
  const { studentId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const children = useChildren();
  const child = children.data?.find((c) => c.id === studentId);
  const requestedPeriod = params.get('periodo');
  const period =
    child?.periods.find((p) => p.id === requestedPeriod) ??
    child?.periods.find((p) => p.current) ??
    child?.periods[0];
  const tab: Tab = (TABS.find((t) => t.key === params.get('ver'))?.key ?? 'avance') as Tab;
  const set = (changes: Record<string, string>) =>
    setParams({ ...Object.fromEntries(params), ...changes }, { replace: true });

  if (children.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!child) {
    return <p className="text-sm text-muted-foreground">No encontramos a este alumno.</p>;
  }
  const many = (children.data?.length ?? 0) > 1;

  return (
    <div>
      <PageHeader
        title={child.shortName}
        description={`Grupo ${child.group.name}${child.teacher ? ` · ${child.teacher}` : ''} · Ciclo ${child.schoolYear}`}
        back={many ? { to: '/padres', label: 'Mis hijos' } : undefined}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        {many ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="child">Hijo(a)</Label>
            <Select
              id="child"
              value={child.id}
              onChange={(e) => navigate(`/padres/hijos/${e.target.value}?ver=${tab}`)}
            >
              {children.data!.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.shortName} · {c.group.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {child.periods.length > 1 && tab !== 'boletas' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="period">Periodo</Label>
            <Select
              id="period"
              value={period?.id ?? ''}
              onChange={(e) => set({ periodo: e.target.value })}
            >
              {child.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <div
        role="tablist"
        aria-label="Secciones"
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => set({ ver: t.key })}
            className={cn(
              'flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium',
              tab === t.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'avance' ? <ProgressTab studentId={child.id} periodId={period?.id} /> : null}
      {tab === 'actividades' ? <ActivitiesTab studentId={child.id} periodId={period?.id} /> : null}
      {tab === 'notas' ? <NotesTab studentId={child.id} periodId={period?.id} /> : null}
      {tab === 'boletas' ? <ReportCardsTab studentId={child.id} name={child.shortName} /> : null}
    </div>
  );
}

function Loading() {
  return (
    <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
  );
}

function ProgressTab({ studentId, periodId }: { studentId: string; periodId?: string }) {
  const overview = useChildOverview(studentId, periodId);
  if (overview.isLoading) return <Loading />;
  if (!overview.data) return <p className="text-sm text-muted-foreground">Sin información.</p>;
  const data = overview.data;
  return (
    <div className="flex flex-col gap-4">
      {data.supportMessage ? (
        <Alert variant="info" className="flex items-start gap-2">
          <Heart className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {data.supportMessage} Con un poco de práctica en casa puede mejorar; si tienes dudas,
            platica con la maestra.
          </span>
        </Alert>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.fields.map((f) => (
          <li key={f.fieldKey}>
            <Card className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: FIELD_COLORS[f.fieldKey] }}
                    aria-hidden
                  />
                  {f.name}
                </span>
                <Badge tone="neutral">en curso</Badge>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="h-3 flex-1 overflow-hidden rounded-full bg-muted"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={10}
                  aria-valuenow={f.average ?? 0}
                  aria-label={`Promedio de ${f.name}`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${((f.average ?? 0) / 10) * 100}%`,
                      backgroundColor: LINE_COLORS[f.fieldKey],
                    }}
                  />
                </div>
                <span
                  className={cn(
                    'w-10 text-right text-xl font-semibold tabular-nums',
                    f.needsSupport && 'text-amber-700',
                  )}
                >
                  {f.average === null ? '—' : f.average.toFixed(1)}
                </span>
              </div>
              {f.average === null ? (
                <p className="mt-1 text-xs text-muted-foreground">Aún no hay calificaciones.</p>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      <WeeklyChart weekly={data.weekly} />
      <p className="text-xs text-muted-foreground">
        Promedios en curso con las actividades calificadas hasta hoy. La calificación oficial es la
        de la boleta.
      </p>
    </div>
  );
}

function WeeklyChart({ weekly }: { weekly: ChildOverview['weekly'] }) {
  if (weekly.length < 2) return null;
  const rows = weekly.map((w) => ({
    week: formatDate(`${w.week}T12:00:00Z`, 'd MMM'),
    ...w.values,
  }));
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">Cómo ha ido cada semana</h2>
      <div className="h-60" role="img" aria-label="Gráfica de la evolución semanal por campo">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value) =>
                typeof value === 'number' ? value.toFixed(1) : String(value ?? '')
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {(Object.keys(LINE_COLORS) as (keyof typeof FIELD_SHORT_NAMES)[]).map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={FIELD_SHORT_NAMES[key]}
                stroke={LINE_COLORS[key]}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function ActivitiesTab({ studentId, periodId }: { studentId: string; periodId?: string }) {
  const activities = useChildActivities(studentId, periodId);
  if (activities.isLoading) return <Loading />;
  const list = activities.data ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">Aún no hay actividades calificadas.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {list.map((a) => {
        const grade = gradeLabel(a.grade);
        return (
          <li
            key={a.id}
            className="flex items-stretch overflow-hidden rounded-lg border border-border bg-card"
          >
            <span
              className="w-1.5 shrink-0"
              style={{ backgroundColor: FIELD_COLORS[a.fieldKey] }}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-snug">{a.name}</span>
                <span className="text-xs text-muted-foreground">
                  {FIELD_SHORT_NAMES[a.fieldKey]} · {COMPONENT_LABELS[a.component]} ·{' '}
                  {formatDate(`${a.date}T12:00:00Z`, "d 'de' MMM")}
                </span>
              </span>
              <span className={cn('shrink-0 text-right text-lg font-semibold', grade.tone)}>
                {grade.text}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function NotesTab({ studentId, periodId }: { studentId: string; periodId?: string }) {
  const notes = useChildNotes(studentId, periodId);
  if (notes.isLoading) return <Loading />;
  const list = notes.data ?? [];
  if (list.length === 0) {
    return <p className="text-sm text-muted-foreground">La maestra aún no ha dejado notas.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {list.map((n) => (
        <li key={n.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={n.kind === 'RECONOCIMIENTO' ? 'success' : 'primary'}>
              {NOTE_KIND_LABELS[n.kind]}
            </Badge>
            {n.fieldKey ? <Badge>{FIELD_NAMES[n.fieldKey]}</Badge> : null}
          </div>
          <p className="mt-2 whitespace-pre-line text-sm">{n.text}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {formatDate(`${n.date}T12:00:00Z`, "d 'de' MMMM")} · {n.author}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ReportCardsTab({ studentId, name }: { studentId: string; name: string }) {
  const cards = useChildReportCards(studentId);
  const [downloading, setDownloading] = useState<string | null>(null);
  if (cards.isLoading) return <Loading />;
  const list = cards.data ?? [];
  if (list.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no hay boletas publicadas. Aparecerán aquí cuando la escuela las publique.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {list.map((card) => (
        <li key={card.period.id}>
          <Card className="p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{card.period.name}</h2>
                {card.publishedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Publicada el {formatDate(card.publishedAt, "d 'de' MMMM")}
                  </p>
                ) : null}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Promedio general</p>
                <p className="text-2xl font-semibold text-primary">
                  {card.generalAverage?.toFixed(1) ?? '—'}
                </p>
              </div>
            </div>
            <ul className="mb-4 flex flex-col divide-y divide-border rounded-md border border-border">
              {card.fields.map((f) => (
                <li key={f.fieldKey} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: FIELD_COLORS[f.fieldKey] }}
                      aria-hidden
                    />
                    {f.name}
                  </span>
                  <span className="text-xl font-semibold tabular-nums">
                    {f.final ?? '—'}
                    {f.adjusted ? '*' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              className="w-full sm:w-auto"
              disabled={downloading !== null}
              onClick={async () => {
                setDownloading(card.period.id);
                try {
                  await downloadChildReportCard(
                    studentId,
                    card.period.id,
                    `Boleta ${name} - ${card.period.name}.pdf`,
                  );
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setDownloading(null);
                }
              }}
            >
              {downloading === card.period.id ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <FileDown aria-hidden />
              )}
              Descargar boleta (PDF)
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
