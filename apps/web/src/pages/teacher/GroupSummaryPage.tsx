import { LoaderCircle } from 'lucide-react';
import { useParams } from 'react-router';
import { useGroup } from '@/api/catalog';
import { useGroupSummary } from '@/api/summary';
import { PageHeader } from '@/components/PageHeader';
import { GroupSummaryView } from '@/components/summary/GroupSummaryView';
import { ApiError } from '@/lib/api-client';

/**
 * Live summary of a group. Teachers: /maestro/grupos/:id/resumen (links to capture and student
 * files). Director: /director/grupos/:id/resumen (read only).
 */
export function GroupSummaryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const period = group.data?.currentPeriod;
  const summary = useGroupSummary(groupId, period?.id);
  const base = readOnly ? '/director' : `/maestro/grupos/${groupId}`;

  if (group.isLoading || summary.isLoading) {
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
  if (!period)
    return <p className="text-sm text-muted-foreground">El ciclo aún no tiene periodos.</p>;
  if (summary.error) {
    return (
      <p className="text-sm text-muted-foreground">
        {summary.error instanceof ApiError && summary.error.status === 403
          ? 'El resumen muestra todos los campos del grupo; solo lo ven el maestro titular y la dirección.'
          : 'No pudimos cargar el resumen.'}
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title={`Resumen · ${group.data.name}`}
        description={`${period.name} · ${group.data.studentCount} alumnos${
          summary.data
            ? ` · Promedio del grupo ${summary.data.stats.generalAverage?.toFixed(1) ?? '—'}`
            : ''
        }${readOnly ? ' · Solo lectura' : ''}`}
        back={
          readOnly
            ? { to: '/director', label: 'Tablero' }
            : { to: base, label: `Grupo ${group.data.name}` }
        }
      />
      {summary.data ? (
        <GroupSummaryView
          summary={summary.data}
          readOnly={readOnly}
          studentHref={readOnly ? undefined : (studentId) => `${base}/alumnos/${studentId}`}
        />
      ) : null}
    </div>
  );
}
