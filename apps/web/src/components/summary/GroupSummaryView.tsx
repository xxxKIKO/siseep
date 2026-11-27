import type { FieldKey, GroupSummary, SummaryAlert, SummaryStudent } from '@siseep/shared';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/dates';
import { COMPONENT_LABELS, SUBJECT_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { formatAverage, gradeTone, TONE_CLASSES } from './grade-style';

interface GroupSummaryViewProps {
  summary: GroupSummary;
  /** Director: no links to capture. */
  readOnly?: boolean;
  /** Link to a student's file (teacher) or nothing. */
  studentHref?: (studentId: string) => string | undefined;
  /** Link to capture an activity (default: the teacher portal). */
  activityHref?: (activityId: string) => string;
}

const teacherActivity = (activityId: string) => `/maestro/actividades/${activityId}`;

/** Live summary: "Atención" + one card per student (phones) or a table (from 768 px). */
export function GroupSummaryView({
  summary,
  readOnly,
  studentHref,
  activityHref = teacherActivity,
}: GroupSummaryViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <Attention summary={summary} readOnly={readOnly} activityHref={activityHref} />
      <FieldAverages summary={summary} />
      <StudentCards summary={summary} studentHref={studentHref} />
      <StudentTable summary={summary} studentHref={studentHref} />
      <p className="text-xs text-muted-foreground">
        Promedios en vivo con las reglas del ciclo. "Parcial": al campo le falta un componente y los
        pesos se reparten entre lo que sí hay. * = calificación ajustada. Actualizado{' '}
        {formatDate(summary.generatedAt, "d 'de' MMM, h:mm aaaa")}.
      </p>
    </div>
  );
}

function Attention({
  summary,
  readOnly,
  activityHref,
}: {
  summary: GroupSummary;
  readOnly?: boolean;
  activityHref: (activityId: string) => string;
}) {
  const lows = summary.alerts.filter((a) => a.type === 'LOW_6' || a.type === 'LOW_7');
  const byStudent = new Map<string, SummaryAlert[]>();
  for (const alert of lows)
    byStudent.set(alert.studentId, [...(byStudent.get(alert.studentId) ?? []), alert]);
  const nameOf = (id: string) => summary.students.find((s) => s.student.id === id)?.student;
  const fieldName = (key: FieldKey) => summary.fields.find((f) => f.key === key)?.shortName ?? key;

  if (byStudent.size === 0 && summary.pendingActivities.length === 0) {
    return (
      <Card className="p-4 text-sm text-emerald-800">
        Sin alertas: nadie está por debajo de 7 y no hay calificaciones pendientes.
      </Card>
    );
  }

  return (
    <section aria-labelledby="attention-title">
      <h2 id="attention-title" className="mb-2 flex items-center gap-2 text-lg font-semibold">
        <TriangleAlert className="size-5 text-amber-600" aria-hidden /> Atención
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {byStudent.size ? (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">
              Alumnos con campos bajos ({byStudent.size})
            </h3>
            <ul className="flex flex-col gap-2 text-sm">
              {[...byStudent.entries()].map(([studentId, alerts]) => {
                const student = nameOf(studentId);
                return (
                  <li key={studentId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">
                      {student?.listNumber}. {student?.shortName}
                    </span>
                    {alerts.map((a) => (
                      <Badge key={a.fieldKey} tone={a.type === 'LOW_6' ? 'danger' : 'warning'}>
                        {fieldName(a.fieldKey)} {formatAverage(a.value)}
                      </Badge>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
        {summary.pendingActivities.length ? (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">
              Actividades con calificaciones pendientes ({summary.pendingActivities.length})
            </h3>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {summary.pendingActivities.map((a) => {
                const content = (
                  <>
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: summary.fields.find((f) => f.key === a.fieldKey)?.color,
                      }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {fieldName(a.fieldKey)} ·{' '}
                        {a.subjectKey
                          ? SUBJECT_LABELS[a.subjectKey]
                          : COMPONENT_LABELS[a.component]}{' '}
                        · {formatDate(`${a.date}T12:00:00Z`, "d 'de' MMM")}
                      </span>
                    </span>
                    <Badge tone="warning">{a.pending} sin calificar</Badge>
                    {readOnly ? null : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </>
                );
                return (
                  <li key={a.activityId}>
                    {readOnly ? (
                      <div className="flex min-h-11 items-center gap-2 py-2">{content}</div>
                    ) : (
                      <Link
                        to={activityHref(a.activityId)}
                        className="flex min-h-11 items-center gap-2 py-2"
                      >
                        {content}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>
    </section>
  );
}

function FieldAverages({ summary }: { summary: GroupSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {summary.stats.byField.map((stat) => {
        const field = summary.fields.find((f) => f.key === stat.fieldKey)!;
        return (
          <Card key={stat.fieldKey} className="overflow-hidden">
            <div className="h-1.5" style={{ backgroundColor: field.color }} aria-hidden />
            <div className="p-3">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {field.shortName}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{formatAverage(stat.average)}</p>
              <p className="text-xs text-muted-foreground">
                {stat.lowCount ? `${stat.lowCount} bajo 7` : 'Nadie bajo 7'}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function FieldChip({
  label,
  color,
  field,
}: {
  label: string;
  color: string;
  field: SummaryStudent['result']['fields'][number];
}) {
  const tone = gradeTone(field.calculated);
  return (
    <div className={cn('flex flex-col rounded-md border px-2 py-1.5', TONE_CLASSES[tone])}>
      <span className="flex items-center gap-1 text-[11px] font-medium leading-tight">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="text-lg font-semibold leading-tight tabular-nums">
        {formatAverage(field.calculated)}
        {field.final !== null ? (
          <span className="ml-1 text-xs font-normal opacity-80">
            → {field.final}
            {field.adjusted ? '*' : ''}
          </span>
        ) : null}
      </span>
      {field.partial ? <span className="text-[11px] font-medium">parcial</span> : null}
    </div>
  );
}

function StudentCards({
  summary,
  studentHref,
}: {
  summary: GroupSummary;
  studentHref?: (id: string) => string | undefined;
}) {
  return (
    <ul className="flex flex-col gap-3 md:hidden" aria-label="Promedios por alumno">
      {summary.students.map(({ student, result }) => {
        const href = studentHref?.(student.id);
        const header = (
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-semibold">
              {student.listNumber}. {student.shortName}
            </span>
            <span className="shrink-0 text-sm text-muted-foreground">
              Prom.{' '}
              <strong className="text-foreground">{formatAverage(result.generalAverage)}</strong>
            </span>
          </span>
        );
        return (
          <li key={student.id}>
            <Card className="p-3">
              {href ? (
                <Link to={href} className="block min-h-11">
                  {header}
                </Link>
              ) : (
                header
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                {result.fields.map((f) => {
                  const meta = summary.fields.find((m) => m.key === f.fieldKey)!;
                  return (
                    <FieldChip
                      key={f.fieldKey}
                      label={meta.shortName}
                      color={meta.color}
                      field={f}
                    />
                  );
                })}
              </div>
              {result.pending ? (
                <p className="mt-2 text-xs text-amber-800">
                  {result.pending} calificaciones pendientes
                </p>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function StudentTable({
  summary,
  studentHref,
}: {
  summary: GroupSummary;
  studentHref?: (id: string) => string | undefined;
}) {
  const [expanded, setExpanded] = useState<Set<FieldKey>>(new Set());
  const toggle = (key: FieldKey) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card className="hidden overflow-x-auto md:block">
      <table className="w-full text-sm">
        <caption className="sr-only">Promedios por alumno y campo formativo</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" rowSpan={2} className="px-3 py-2 text-left font-medium">
              Alumno(a)
            </th>
            {summary.fields.map((field) => (
              <th
                key={field.key}
                scope="colgroup"
                colSpan={expanded.has(field.key) ? (field.complementaryName ? 6 : 5) : 1}
                className="border-l border-border px-2 py-1 font-medium"
                style={{ boxShadow: `inset 0 3px 0 ${field.color}` }}
              >
                <button
                  type="button"
                  onClick={() => toggle(field.key)}
                  aria-expanded={expanded.has(field.key)}
                  className="flex min-h-9 w-full items-center justify-center gap-1 rounded hover:bg-muted"
                >
                  {field.shortName}
                  <ChevronDown
                    className={cn(
                      'size-3.5 transition-transform',
                      expanded.has(field.key) && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>
              </th>
            ))}
            <th scope="col" rowSpan={2} className="border-l border-border px-3 py-2 font-medium">
              Promedio
            </th>
          </tr>
          <tr className="border-b border-border text-[11px] text-muted-foreground">
            {summary.fields.map((field) =>
              expanded.has(field.key) ? (
                <Fragment key={field.key}>
                  <th scope="col" className="border-l border-border px-1 font-normal">
                    D
                  </th>
                  <th scope="col" className="px-1 font-normal">
                    P
                  </th>
                  <th scope="col" className="px-1 font-normal">
                    E
                  </th>
                  {field.complementaryName ? (
                    <th scope="col" className="px-1 font-normal" title={field.complementaryName}>
                      {field.complementaryName.slice(0, 3)}.
                    </th>
                  ) : null}
                  <th scope="col" className="px-1 font-normal">
                    Calc.
                  </th>
                  <th scope="col" className="px-1 font-normal">
                    Final
                  </th>
                </Fragment>
              ) : (
                <th key={field.key} scope="col" className="border-l border-border px-1 font-normal">
                  Calc. → final
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {summary.students.map(({ student, result }) => {
            const href = studentHref?.(student.id);
            return (
              <tr key={student.id} className="border-b border-border last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {href ? (
                    <Link to={href} className="hover:underline">
                      {student.listNumber}. {student.shortName}
                    </Link>
                  ) : (
                    `${student.listNumber}. ${student.shortName}`
                  )}
                </th>
                {result.fields.map((f) => {
                  const field = summary.fields.find((m) => m.key === f.fieldKey)!;
                  const tone = gradeTone(f.calculated);
                  const final = (
                    <span className="font-semibold">
                      {f.final ?? '—'}
                      {f.adjusted ? '*' : ''}
                    </span>
                  );
                  if (!expanded.has(f.fieldKey)) {
                    return (
                      <td
                        key={f.fieldKey}
                        className={cn(
                          'border-l border-border px-2 py-2 text-center tabular-nums',
                          tone === 'red' && 'bg-red-50 text-red-900',
                          tone === 'amber' && 'bg-amber-50 text-amber-900',
                        )}
                      >
                        {formatAverage(f.calculated)} → {final}
                        {f.partial ? (
                          <span className="block text-[10px] font-medium">parcial</span>
                        ) : null}
                      </td>
                    );
                  }
                  return (
                    <Fragment key={f.fieldKey}>
                      <td className="border-l border-border px-1 py-2 text-center tabular-nums">
                        {formatAverage(f.components.DESEMPENO.value)}
                      </td>
                      <td className="px-1 py-2 text-center tabular-nums">
                        {formatAverage(f.components.PROYECTO.value)}
                      </td>
                      <td className="px-1 py-2 text-center tabular-nums">
                        {formatAverage(f.components.EXAMEN.value)}
                      </td>
                      {field.complementaryName ? (
                        <td className="px-1 py-2 text-center tabular-nums">
                          {formatAverage(f.complementary?.value)}
                        </td>
                      ) : null}
                      <td
                        className={cn(
                          'px-1 py-2 text-center tabular-nums',
                          tone === 'red' && 'bg-red-50 text-red-900',
                          tone === 'amber' && 'bg-amber-50 text-amber-900',
                        )}
                      >
                        {f.calculated === null ? '—' : f.calculated.toFixed(2)}
                      </td>
                      <td className="px-1 py-2 text-center tabular-nums">{final}</td>
                    </Fragment>
                  );
                })}
                <td className="border-l border-border px-3 py-2 text-center font-semibold tabular-nums">
                  {formatAverage(result.generalAverage)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
