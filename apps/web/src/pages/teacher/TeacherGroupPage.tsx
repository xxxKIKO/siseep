import {
  type ActivityView,
  type Component,
  COMPONENTS,
  FIELD_COLORS,
  FIELD_KEYS,
  FIELD_NAMES,
  type FieldKey,
} from '@siseep/shared';
import {
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  FileDown,
  LoaderCircle,
  MoreVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  downloadCaptureSheet,
  useActivities,
  useDeleteActivity,
  useGroupNotes,
} from '@/api/capture';
import { useGroup, useRoster } from '@/api/catalog';
import { useAuth } from '@/auth/auth-context';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiError, errorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import {
  COMPLEMENTARY_BY_FIELD,
  COMPONENT_LABELS,
  FIELD_SHORT_LABELS,
  PERIOD_STATUS_LABELS,
  SUBJECT_LABELS,
  todayDateOnly,
} from '@/lib/labels';
import { cn } from '@/lib/utils';
import { NewActivitySheet } from './NewActivitySheet';
import { NotesList } from './NotesList';

type Tab = FieldKey | 'alumnos' | 'notas';

/** /maestro/grupos/:groupId — field tabs, list of activities, students and today's notes. */
export function TeacherGroupPage() {
  const { groupId = '' } = useParams();
  const { user } = useAuth();
  const group = useGroup(groupId);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  if (group.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!group.data)
    return (
      <p className="text-sm text-muted-foreground">No encontramos el grupo o no tienes acceso.</p>
    );

  const g = group.data;
  const mine = g.assignments.filter((a) => a.teacher.id === user?.id);
  const homeroom = mine.some((a) => a.scope === 'HOMEROOM') || user?.roles.includes('ADMIN');
  const subject = homeroom ? undefined : mine.find((a) => a.scope === 'SUBJECT')?.subjectKey;
  const fields = subject
    ? FIELD_KEYS.filter((f) => COMPLEMENTARY_BY_FIELD[f] === subject)
    : [...FIELD_KEYS];
  const tabs: { key: Tab; label: string; color?: string }[] = [
    ...fields.map((f) => ({ key: f as Tab, label: FIELD_SHORT_LABELS[f], color: FIELD_COLORS[f] })),
    { key: 'alumnos', label: 'Alumnos' },
    ...(homeroom ? [{ key: 'notas' as Tab, label: 'Notas de hoy' }] : []),
  ];
  const requested = params.get('campo') as Tab | null;
  const tab: Tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0]!.key;
  const period = g.currentPeriod;
  const isField = (FIELD_KEYS as readonly string[]).includes(tab);

  return (
    <div>
      <PageHeader
        title={`Grupo ${g.name}`}
        description={`${period ? `${period.name}${period.status === 'OPEN' ? '' : ` (${PERIOD_STATUS_LABELS[period.status].toLowerCase()})`}` : 'Sin periodo'} · ${g.studentCount} alumnos${subject ? ` · ${SUBJECT_LABELS[subject]}` : ''}`}
        back={{ to: '/maestro', label: 'Mis grupos' }}
        actions={
          homeroom && period ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/maestro/grupos/${g.id}/resumen`}>
                  <BarChart3 aria-hidden /> Resumen
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/maestro/grupos/${g.id}/cierre`}>
                  <ClipboardCheck aria-hidden /> Cierre y boletas
                </Link>
              </Button>
            </>
          ) : null
        }
      />

      <div
        role="tablist"
        aria-label="Secciones del grupo"
        className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setParams({ campo: t.key }, { replace: true })}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium',
              tab === t.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card',
            )}
          >
            {t.color ? (
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: t.color }}
                aria-hidden
              />
            ) : null}
            {t.label}
          </button>
        ))}
      </div>

      {isField && period ? (
        <ActivitiesTab
          groupId={g.id}
          periodId={period.id}
          fieldKey={tab as FieldKey}
          canEdit={period.status === 'OPEN'}
        />
      ) : null}
      {isField && !period ? (
        <p className="text-sm text-muted-foreground">
          El ciclo aún no tiene periodos. Pide a la administración que los cree.
        </p>
      ) : null}
      {tab === 'alumnos' ? <StudentsTab groupId={g.id} /> : null}
      {tab === 'notas' ? <TodayNotesTab groupId={g.id} /> : null}

      {isField && period?.status === 'OPEN' ? (
        <>
          <Button
            size="lg"
            className="fixed bottom-20 right-4 z-20 rounded-full shadow-lg lg:bottom-8 lg:right-8"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden /> Actividad
          </Button>
          <Dialog open={creating} onOpenChange={setCreating}>
            {creating ? (
              <NewActivitySheet
                groupId={g.id}
                periodId={period.id}
                defaultField={tab as FieldKey}
                onlySubject={subject}
              />
            ) : null}
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

function ActivitiesTab({
  groupId,
  periodId,
  fieldKey,
  canEdit,
}: {
  groupId: string;
  periodId: string;
  fieldKey: FieldKey;
  canEdit: boolean;
}) {
  const activities = useActivities(groupId, periodId);
  const remove = useDeleteActivity();
  if (activities.isLoading)
    return (
      <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
    );
  const mine = (activities.data ?? []).filter((a) => a.fieldKey === fieldKey);
  if (mine.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        Aún no hay actividades en {FIELD_NAMES[fieldKey]}. Toca "+ Actividad" para crear la primera.
      </p>
    );
  }

  const deleteActivity = (activity: ActivityView) => {
    const message =
      activity.gradedCount > 0
        ? `"${activity.name}" tiene ${activity.gradedCount} calificaciones. ¿Borrarla junto con ellas?`
        : `¿Borrar "${activity.name}"?`;
    if (!window.confirm(message)) return;
    remove.mutate(
      { id: activity.id, groupId, force: activity.gradedCount > 0 },
      {
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : errorMessage(error)),
      },
    );
  };

  const byComponent = COMPONENTS.map((component) => ({
    component,
    items: mine.filter((a) => a.component === component),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5 pb-16">
      {byComponent.map(({ component, items }) => (
        <section key={component} aria-labelledby={`component-${component}`}>
          <h2
            id={`component-${component}`}
            className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {componentTitle(component, items[0]!)}
          </h2>
          <ul className="flex flex-col gap-2">
            {items.map((activity) => {
              const complete =
                activity.gradedCount >= activity.studentCount && activity.studentCount > 0;
              return (
                <li
                  key={activity.id}
                  className="flex items-stretch overflow-hidden rounded-lg border border-border bg-card"
                >
                  <span
                    className="w-1.5 shrink-0"
                    style={{ backgroundColor: FIELD_COLORS[fieldKey] }}
                    aria-hidden
                  />
                  <Link
                    to={`/maestro/actividades/${activity.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-medium leading-snug">{activity.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {formatDate(`${activity.date}T12:00:00Z`, "EEE d 'de' MMM")}
                          {activity.medium ? ` · ${activity.medium}` : ''}
                        </span>
                        <Badge tone={complete ? 'success' : 'warning'}>
                          {activity.gradedCount}/{activity.studentCount} capturados
                        </Badge>
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground"
                      aria-label={`Opciones de ${activity.name}`}
                    >
                      <MoreVertical className="size-5" aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => void downloadCaptureSheet(groupId, activity)}
                      >
                        <FileDown aria-hidden /> Hoja de captura
                      </DropdownMenuItem>
                      {canEdit ? (
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => deleteActivity(activity)}
                        >
                          <Trash2 aria-hidden /> Borrar actividad
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function componentTitle(component: Component, sample: ActivityView): string {
  if (component === 'COMPLEMENTARIA' && sample.subjectKey) return SUBJECT_LABELS[sample.subjectKey];
  return COMPONENT_LABELS[component];
}

function StudentsTab({ groupId }: { groupId: string }) {
  const roster = useRoster(groupId);
  if (roster.isLoading)
    return (
      <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
    );
  const active = (roster.data ?? []).filter((e) => e.status === 'ACTIVE');
  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => void downloadCaptureSheet(groupId)}
      >
        <FileDown aria-hidden /> Hoja de captura en blanco
      </Button>
      <ol
        className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card"
        aria-label="Alumnos por número de lista"
      >
        {active.map((entry) => (
          <li key={entry.enrollmentId}>
            <Link
              to={`/maestro/grupos/${groupId}/alumnos/${entry.student.id}`}
              className="flex min-h-12 items-center gap-3 px-3 py-2"
            >
              <span className="w-7 text-right font-mono text-sm tabular-nums text-muted-foreground">
                {entry.listNumber}
              </span>
              <span className="min-w-0 flex-1 truncate">{entry.student.fullName}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TodayNotesTab({ groupId }: { groupId: string }) {
  const [date, setDate] = useState(todayDateOnly());
  const notes = useGroupNotes(groupId, date);
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-3 text-sm">
        <span className="font-medium">Día</span>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="h-11 rounded-md border border-input bg-card px-3"
        />
      </label>
      {notes.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : (
        <NotesList
          notes={notes.data}
          groupId={groupId}
          showStudent
          empty="No hay notas este día. Para escribir una, abre la ficha del alumno en la pestaña Alumnos."
        />
      )}
    </div>
  );
}
