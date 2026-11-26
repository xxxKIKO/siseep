import {
  GRANTABLE_ACTION_LABELS,
  GRANTABLE_ACTIONS,
  type GrantableAction,
  type PermissionGrantView,
} from '@siseep/shared';
import { KeyRound, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCreateGrant, useGrants, useGroups, useRevokeGrant, useUsers } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiveList } from '@/components/ResponsiveList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/dates';

const actionLabel = (action: string) =>
  GRANTABLE_ACTION_LABELS[action as GrantableAction] ?? action;

export function GrantsPage() {
  const grants = useGrants();
  const revoke = useRevokeGrant();
  const [creating, setCreating] = useState(false);

  const scope = (g: PermissionGrantView) =>
    g.scope.type === 'SCHOOL' ? 'Toda la escuela' : `Grupo ${g.scope.groupName ?? ''}`;
  const expiry = (g: PermissionGrantView) => (
    <span className="flex items-center gap-2">
      {g.expiresAt ? formatDate(g.expiresAt, 'd MMM yyyy, h:mm aaaa') : 'Sin vencimiento'}
      {g.active ? null : <Badge tone="neutral">Vencido</Badge>}
    </span>
  );
  const revokeButton = (g: PermissionGrantView) => (
    <Button
      variant="ghost"
      size="sm"
      disabled={revoke.isPending}
      onClick={() => revoke.mutate(g.id)}
    >
      <Trash2 aria-hidden /> Revocar
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Permisos especiales"
        description="Permisos de edición puntuales, por ejemplo para que la dirección corrija calificaciones de un grupo por unos días."
        back={{ to: '/admin', label: 'Administración' }}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Otorgar permiso
          </Button>
        }
      />
      <ResponsiveList
        label="Permisos especiales"
        rows={grants.data}
        loading={grants.isLoading}
        rowKey={(g) => g.id}
        empty="No hay permisos especiales."
        columns={[
          { header: 'Persona', cell: (g) => <span className="font-medium">{g.user.name}</span> },
          { header: 'Permiso', cell: (g) => actionLabel(g.action) },
          { header: 'Alcance', cell: scope },
          { header: 'Vence', cell: expiry },
          { header: 'Motivo', cell: (g) => g.reason ?? '—' },
          { header: 'Acciones', className: 'text-right', cell: revokeButton },
        ]}
        card={(g) => (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 font-medium">
              <KeyRound className="size-4 text-primary" aria-hidden /> {g.user.name}
            </p>
            <p className="text-sm">
              {actionLabel(g.action)} · {scope(g)}
            </p>
            <div className="text-sm text-muted-foreground">{expiry(g)}</div>
            <div>{revokeButton(g)}</div>
          </div>
        )}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <GrantDialog onDone={() => setCreating(false)} /> : null}
      </Dialog>
    </div>
  );
}

function GrantDialog({ onDone }: { onDone: () => void }) {
  const users = useUsers({ limit: 200 });
  const groups = useGroups();
  const create = useCreateGrant();
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState<GrantableAction>('grade:update');
  const [groupId, setGroupId] = useState('');
  const [days, setDays] = useState(2);
  const [reason, setReason] = useState('');

  const submit = () =>
    create.mutate(
      {
        userId,
        action,
        scope: groupId ? { type: 'GROUP', groupId } : { type: 'SCHOOL' },
        ...(days > 0
          ? { expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() }
          : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      },
      { onSuccess: onDone },
    );

  return (
    <DialogContent
      title="Otorgar permiso especial"
      description="Al vencer deja de aplicar solo, sin que nadie lo quite."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-user">Persona</Label>
          <Select id="grant-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Elige una persona…</option>
            {users.data?.items
              .filter((u) => !u.roles.includes('ADMIN') && u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {`${u.firstName} ${u.lastName}`.trim()} · {u.email}
                </option>
              ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-action">Permiso</Label>
          <Select
            id="grant-action"
            value={action}
            onChange={(e) => setAction(e.target.value as GrantableAction)}
          >
            {GRANTABLE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {GRANTABLE_ACTION_LABELS[a]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-group">Alcance</Label>
          <Select id="grant-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Toda la escuela</option>
            {groups.data?.map((g) => (
              <option key={g.id} value={g.id}>
                Solo el grupo {g.name} ({g.schoolYearName})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-days">Días de vigencia (0 = sin vencimiento)</Label>
          <Input
            id="grant-days"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grant-reason">Motivo (opcional)</Label>
          <Input id="grant-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <Button size="lg" disabled={!userId || create.isPending} onClick={submit}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Otorgar permiso
        </Button>
      </div>
    </DialogContent>
  );
}
