import { CalendarDays, ChevronRight, LoaderCircle, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useGroups } from '@/api/catalog';
import { useAuth } from '@/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PERIOD_STATUS_LABELS, SUBJECT_LABELS } from '@/lib/labels';

/** /maestro: one card per group the teacher teaches. */
export function TeacherHomePage() {
  const { user } = useAuth();
  const groups = useGroups();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Mis grupos</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user ? `, ${user.firstName}` : ''}
        </h1>
      </div>
      {groups.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : groups.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.data.map((group) => {
            const mine = group.assignments.find((a) => a.teacher.id === user?.id);
            return (
              <li key={group.id}>
                <Link to={`/maestro/grupos/${group.id}`} className="block rounded-lg">
                  <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
                      {group.name}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        Grupo {group.name}{' '}
                        {mine?.scope === 'SUBJECT' && mine.subjectKey ? (
                          <Badge tone="primary">{SUBJECT_LABELS[mine.subjectKey]}</Badge>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <CalendarDays className="size-4" aria-hidden /> Ciclo {group.schoolYearName}
                        {group.currentPeriod
                          ? ` · ${group.currentPeriod.name} (${PERIOD_STATUS_LABELS[group.currentPeriod.status as keyof typeof PERIOD_STATUS_LABELS].toLowerCase()})`
                          : ''}
                      </span>
                      <span className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Users className="size-4" aria-hidden /> {group.studentCount} alumnos
                      </span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card className="px-5 py-10 text-center text-sm text-muted-foreground">
          Aún no tienes grupos asignados. Pide a la administración que te asigne a tu grupo.
        </Card>
      )}
    </div>
  );
}
