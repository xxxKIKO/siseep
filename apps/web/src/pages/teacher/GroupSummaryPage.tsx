import { LoaderCircle } from 'lucide-react';
import { useParams } from 'react-router';
import { useGroup } from '@/api/catalog';
import { useGroupSummary } from '@/api/summary';
import { useCan, usePortalBase } from '@/auth/ability';
import { PageHeader } from '@/components/PageHeader';
import { GroupSummaryView } from '@/components/summary/GroupSummaryView';
import { ApiError } from '@/lib/api-client';

/**
 * Live summary of a group (/maestro/… and /director/…). Links to capture only where the CASL
 * ability allows editing grades (a director needs an active permission grant).
 */
export function GroupSummaryPage() {
  const { groupId = '' } = useParams();
  const portal = usePortalBase();
  const { can } = useCan();
  const group = useGroup(groupId);
  const period = group.data?.currentPeriod;
  const summary = useGroupSummary(groupId, period?.id);
  const readOnly = !can('update', 'Grade', { groupId });
  const base = `${portal}/grupos/${groupId}`;

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
        back={{ to: base, label: `Grupo ${group.data.name}` }}
      />
      {summary.data ? (
        <GroupSummaryView
          summary={summary.data}
          readOnly={readOnly}
          studentHref={(studentId) => `${base}/alumnos/${studentId}`}
          activityHref={(activityId) => `${portal}/actividades/${activityId}`}
        />
      ) : null}
    </div>
  );
}
