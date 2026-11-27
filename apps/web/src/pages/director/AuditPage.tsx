import { AUDIT_ENTITIES, AUDIT_ENTITY_LABELS, type AuditEntity } from '@siseep/shared';
import { ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useGroups } from '@/api/catalog';
import { type AuditFilters, useAuditLog } from '@/api/guardian';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/dates';

/** Start/end of a calendar day in Mexico City (UTC-6, no daylight saving since 2022). */
const dayStart = (day: string) => `${day}T00:00:00-06:00`;
const dayEnd = (day: string) => `${day}T23:59:59-06:00`;

/** /director/bitacora — who changed what and when, with the before → after in words. */
export function AuditPage() {
  const groups = useGroups();
  const [entity, setEntity] = useState('');
  const [groupId, setGroupId] = useState('');
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const filters: AuditFilters = {
    page,
    ...(entity ? { entity } : {}),
    ...(groupId ? { groupId } : {}),
    ...(actor ? { actorId: actor.id } : {}),
    ...(from ? { from: dayStart(from) } : {}),
    ...(to ? { to: dayEnd(to) } : {}),
  };
  const log = useAuditLog(filters);
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.limit)) : 1;
  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  // People who appear in the results, to filter by "usuario".
  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of log.data?.items ?? []) map.set(item.actor.id, item.actor.name);
    if (actor) map.set(actor.id, actor.name);
    return [...map.entries()].filter(([id]) => id);
  }, [log.data, actor]);

  return (
    <div>
      <PageHeader
        title="Bitácora de cambios"
        description="Quién cambió qué y cuándo: calificaciones, actividades, notas, cierres y vínculos de padres."
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="from">Desde</Label>
          <input
            id="from"
            type="date"
            value={from}
            onChange={(e) => reset(setFrom)(e.target.value)}
            className="h-11 rounded-md border border-input bg-card px-3"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to">Hasta</Label>
          <input
            id="to"
            type="date"
            value={to}
            onChange={(e) => reset(setTo)(e.target.value)}
            className="h-11 rounded-md border border-input bg-card px-3"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group">Grupo</Label>
          <Select id="group" value={groupId} onChange={(e) => reset(setGroupId)(e.target.value)}>
            <option value="">Todos</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entity">Qué cambió</Label>
          <Select id="entity" value={entity} onChange={(e) => reset(setEntity)(e.target.value)}>
            <option value="">Todo</option>
            {AUDIT_ENTITIES.map((key) => (
              <option key={key} value={key}>
                {AUDIT_ENTITY_LABELS[key]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="actor">Usuario</Label>
          <Select
            id="actor"
            value={actor?.id ?? ''}
            onChange={(e) => {
              const found = people.find(([id]) => id === e.target.value);
              reset(setActor)(found ? { id: found[0], name: found[1] } : null);
            }}
          >
            <option value="">Todos</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {log.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : !log.data?.items.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay cambios con estos filtros.
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {log.data.items.map((item) => (
              <li key={item.id}>
                <Card className="p-3">
                  <p className="text-sm font-medium">{item.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge tone="neutral">{AUDIT_ENTITY_LABELS[item.entity as AuditEntity]}</Badge>
                    {item.groupName ? <span>Grupo {item.groupName}</span> : null}
                    <button
                      type="button"
                      className="min-h-8 font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => reset(setActor)(item.actor)}
                      title="Ver solo los cambios de esta persona"
                    >
                      {item.actor.name}
                    </button>
                    <span>{formatDateTime(item.at)}</span>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {log.data.total} cambios · página {page} de {pages}
            </span>
            <div className="flex gap-2">
              {actor ? (
                <Button variant="ghost" size="sm" onClick={() => reset(setActor)(null)}>
                  <X aria-hidden /> Quitar filtro de usuario
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="icon"
                aria-label="Página anterior"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Página siguiente"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
