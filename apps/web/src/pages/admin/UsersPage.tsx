import { zodResolver } from '@hookform/resolvers/zod';
import {
  createStaffInvitationSchema,
  ROLE_LABELS,
  ROLES,
  type Role,
  STAFF_ROLES,
  type User,
} from '@siseep/shared';
import { KeyRound, LoaderCircle, MailPlus, Power, ShieldCheck } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { useAuth } from '@/auth/auth-context';
import {
  useInviteStaff,
  usePendingInvitations,
  useUpdateUser,
  useUserAction,
  useUsers,
} from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiveList } from '@/components/ResponsiveList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/dates';
import { fieldProps } from '@/lib/form';
import { USER_STATUS_LABELS } from '@/lib/labels';

const fullName = (u: User) => `${u.firstName} ${u.lastName}`.trim();

export function UsersPage() {
  const [q, setQ] = useState('');
  const users = useUsers({ q: useDeferredValue(q) });
  const invitations = usePendingInvitations();
  const [inviting, setInviting] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);

  const roles = (u: User) => (
    <span className="flex flex-wrap gap-1">
      {u.roles.map((r) => (
        <Badge key={r} tone="primary">
          {ROLE_LABELS[r]}
        </Badge>
      ))}
    </span>
  );
  const status = (u: User) => (
    <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>
      {USER_STATUS_LABELS[u.status]}
    </Badge>
  );

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="No hay registro abierto: el personal entra por invitación."
        back={{ to: '/admin', label: 'Administración' }}
        actions={
          <Button onClick={() => setInviting(true)}>
            <MailPlus aria-hidden /> Invitar personal
          </Button>
        }
      />
      <Input
        type="search"
        aria-label="Buscar persona"
        placeholder="Buscar por nombre o correo"
        className="mb-4"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ResponsiveList
        label="Usuarios"
        rows={users.data?.items}
        loading={users.isLoading}
        rowKey={(u) => u.id}
        empty="No encontramos personas."
        columns={[
          {
            header: 'Persona',
            cell: (u) => (
              <span>
                <span className="block font-medium">{fullName(u)}</span>
                <span className="text-xs text-muted-foreground">{u.email}</span>
              </span>
            ),
          },
          { header: 'Roles', cell: roles },
          { header: 'Estado', cell: status },
          {
            header: 'Último acceso',
            cell: (u) => (u.lastLoginAt ? formatDate(u.lastLoginAt, 'd MMM yyyy, h:mm aaaa') : '—'),
          },
          {
            header: 'Acciones',
            className: 'text-right',
            cell: (u) => (
              <Button variant="ghost" size="sm" onClick={() => setSelected(u)}>
                Administrar
              </Button>
            ),
          },
        ]}
        card={(u) => (
          <button
            type="button"
            className="flex w-full flex-col gap-2 text-left"
            onClick={() => setSelected(u)}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{fullName(u)}</span>
                <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
              </span>
              {status(u)}
            </span>
            {roles(u)}
          </button>
        )}
      />

      {invitations.data?.length ? (
        <Card className="mt-5 p-4">
          <h2 className="mb-2 font-semibold">Invitaciones pendientes</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {invitations.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate">{i.email}</span>
                <span className="text-xs text-muted-foreground">
                  {i.roles.map((r) => ROLE_LABELS[r as Role]).join(', ')} · vence{' '}
                  {formatDate(i.expiresAt, "d 'de' MMM")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog open={inviting} onOpenChange={setInviting}>
        {inviting ? <InviteDialog onDone={() => setInviting(false)} /> : null}
      </Dialog>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected ? <ManageUserDialog user={selected} onDone={() => setSelected(null)} /> : null}
      </Dialog>
    </div>
  );
}

function RoleCheckboxes({
  roles,
  value,
  onChange,
}: {
  roles: readonly Role[];
  value: Role[];
  onChange: (roles: Role[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((role) => (
        <label key={role} className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={value.includes(role)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
            }
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
    </fieldset>
  );
}

function InviteDialog({ onDone }: { onDone: () => void }) {
  const invite = useInviteStaff();
  const form = useForm<
    z.input<typeof createStaffInvitationSchema>,
    unknown,
    z.output<typeof createStaffInvitationSchema>
  >({
    resolver: zodResolver(createStaffInvitationSchema),
    defaultValues: { email: '', roles: ['TEACHER'] },
  });
  const { errors } = form.formState;
  const selectedRoles = useWatch({ control: form.control, name: 'roles' }) as Role[];
  return (
    <DialogContent
      title="Invitar personal"
      description="Le llegará un correo con un enlace para crear su cuenta (vence en 7 días)."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => invite.mutate(values, { onSuccess: onDone }))}
      >
        <FormField id="email" label="Correo electrónico" error={errors.email?.message}>
          <Input
            type="email"
            inputMode="email"
            autoCapitalize="none"
            {...fieldProps('email', errors.email?.message)}
            {...form.register('email')}
          />
        </FormField>
        <RoleCheckboxes
          roles={STAFF_ROLES}
          value={selectedRoles}
          onChange={(roles) =>
            form.setValue('roles', roles as (typeof STAFF_ROLES)[number][], {
              shouldValidate: true,
            })
          }
        />
        {errors.roles?.message ? (
          <p className="text-sm text-destructive">{errors.roles.message}</p>
        ) : null}
        <Button type="submit" size="lg" disabled={invite.isPending}>
          {invite.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Enviar invitación
        </Button>
      </form>
    </DialogContent>
  );
}

function ManageUserDialog({ user, onDone }: { user: User; onDone: () => void }) {
  const { user: me } = useAuth();
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const update = useUpdateUser();
  const disable = useUserAction('disable');
  const enable = useUserAction('enable');
  const reset = useUserAction('reset-password');
  const isMe = me?.id === user.id;

  return (
    <DialogContent title={fullName(user)} description={user.email}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <RoleCheckboxes roles={ROLES} value={roles} onChange={setRoles} />
          <Button
            variant="outline"
            disabled={update.isPending || roles.length === 0}
            onClick={() => update.mutate({ id: user.id, roles }, { onSuccess: onDone })}
          >
            <ShieldCheck aria-hidden /> Guardar roles
          </Button>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            disabled={reset.isPending || user.status !== 'ACTIVE'}
            onClick={() => reset.mutate(user.id, { onSuccess: onDone })}
          >
            <KeyRound aria-hidden /> Forzar cambio de contraseña
          </Button>
          {user.status === 'ACTIVE' ? (
            <Button
              variant="destructive"
              disabled={isMe || disable.isPending}
              onClick={() => disable.mutate(user.id, { onSuccess: onDone })}
            >
              <Power aria-hidden /> Desactivar cuenta
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={enable.isPending}
              onClick={() => enable.mutate(user.id, { onSuccess: onDone })}
            >
              <Power aria-hidden /> Reactivar cuenta
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Desactivar y forzar el cambio de contraseña cierran todas sus sesiones abiertas.
          </p>
        </div>
      </div>
    </DialogContent>
  );
}
