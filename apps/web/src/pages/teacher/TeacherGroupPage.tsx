import { LoaderCircle } from 'lucide-react';
import { useParams } from 'react-router';
import { useGroup, useRoster } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { RosterList } from '@/components/RosterList';
import { Card, CardContent } from '@/components/ui/card';

/** /maestro/grupos/:id — the list by N/L. Capture arrives in stage 2. */
export function TeacherGroupPage() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const roster = useRoster(groupId);

  if (group.isLoading)
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  if (!group.data)
    return (
      <p className="text-sm text-muted-foreground">No encontramos el grupo o no tienes acceso.</p>
    );

  return (
    <div>
      <PageHeader
        title={`Grupo ${group.data.name}`}
        description={`${group.data.currentPeriod?.name ?? 'Sin periodo'} · ${group.data.studentCount} alumnos`}
        back={{ to: '/maestro', label: 'Mis grupos' }}
      />
      <Card>
        <CardContent className="pt-4">
          <RosterList entries={roster.data} loading={roster.isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}
