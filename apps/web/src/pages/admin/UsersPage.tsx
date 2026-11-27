import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreatedAccountView,
  type CreateStaffInput,
  createStaffSchema,
  formatPhone,
  ROLE_LABELS,
  ROLES,
  type Role,
  STAFF_ROLES,
  type TemporaryPasswordView,
  type User,
} from '@siseep/shared';
import { KeyRound, LoaderCircle, Power, ShieldCheck, UserPlus } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useCreateStaff, useResetUserPassword } from '@/api/account';
import { useUpdateUser, useUserAction, useUsers } from '@/api/catalog';
import { usePortalBase } from '@/auth/ability';
import { useAuth } from '@/auth/auth-context';
import { CredentialsCard } from '@/components/CredentialsCard';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiveList } from '@/components/ResponsiveList';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';
import { fieldProps } from '@/lib/form';
import { USER_STATUS_LABELS } from '@/lib/labels';

const fullName = (u: User) => `${u.firstName} ${u.lastName}`.trim();
/** The direction manages teachers (and guardians from "Padres de familia"); admins everything. */
const DIRECTOR_ROLES: Role[] = ['TEACHER'];

type Credentials = {
  name: string;
  username: string;
  temporaryPassword: string;
  phone?: string | null;
};

/**
 * /admin/usuarios and /director/usuarios: accounts of the school. New accounts get a username
 * (MAE26-0001…) and a temporary password that the person changes at the first sign-in.
 */
export function UsersPage() {
  const base = usePortalBase();
  const { user: me } = useAuth();
  const isAdmin = me?.roles.includes('ADMIN') ?? false;
  const [q, setQ] = useState('');
  const users = useUsers({ q: useDeferredValue(q) });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const manageable = (u: User) =>
    isAdmin || u.roles.every((r) => r === 'TEACHER' || r === 'GUARDIAN');

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
    <span className="flex flex-wrap gap-1">
      <Badge tone={u.status === 'ACTIVE' ? 'success' : 'danger'}>
        {USER_STATUS_LABELS[u.status]}
      </Badge>
      {u.mustChangePassword ? <Badge tone="warning">Aún no entra</Badge> : null}
    </span>
  );
  const contact = (u: User) =>
    [u.email, u.phone ? formatPhone(u.phone) : null].filter(Boolean).join(' · ');

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description={
          isAdmin
            ? 'Cada persona entra con su usuario (MAE26-0001…) y una contraseña temporal que cambia al entrar.'
            : 'Agrega o desactiva maestros. Asígnales grupo desde Grupos → Maestros del grupo.'
        }
        back={{ to: base, label: base === '/director' ? 'Tablero' : 'Administración' }}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus aria-hidden /> {isAdmin ? 'Nueva cuenta' : 'Agregar maestro(a)'}
          </Button>
        }
      />
      <Input
        type="search"
        aria-label="Buscar persona"
        placeholder="Buscar por nombre, usuario o correo"
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
                <span className="block font-mono text-xs text-primary">{u.username}</span>
                <span className="text-xs text-muted-foreground">{contact(u)}</span>
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
            cell: (u) =>
              manageable(u) ? (
                <Button variant="ghost" size="sm" onClick={() => setSelected(u)}>
                  Administrar
                </Button>
              ) : null,
          },
        ]}
        card={(u) => (
          <button
            type="button"
            className="flex w-full flex-col gap-2 text-left disabled:opacity-100"
            disabled={!manageable(u)}
            onClick={() => setSelected(u)}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{fullName(u)}</span>
                <span className="block font-mono text-xs text-primary">{u.username}</span>
                <span className="block truncate text-xs text-muted-foreground">{contact(u)}</span>
              </span>
              {status(u)}
            </span>
            {roles(u)}
          </button>
        )}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? (
          <CreateAccountDialog
            allowedRoles={isAdmin ? [...STAFF_ROLES] : DIRECTOR_ROLES}
            onDone={(account) => {
              setCreating(false);
              setCredentials({
                name: fullName(account.user),
                username: account.username,
                temporaryPassword: account.temporaryPassword!,
                phone: account.user.phone,
              });
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        {selected ? (
          <ManageUserDialog
            user={selected}
            allowedRoles={isAdmin ? [...ROLES] : DIRECTOR_ROLES}
            onDone={() => setSelected(null)}
            onReset={(view) => {
              setSelected(null);
              setCredentials({
                name: fullName(selected),
                username: view.username,
                temporaryPassword: view.temporaryPassword,
                phone: selected.phone,
              });
            }}
          />
        ) : null}
      </Dialog>
      <Dialog open={credentials !== null} onOpenChange={(open) => !open && setCredentials(null)}>
        {credentials ? (
          <DialogContent title="Datos de acceso" description="Entrégalos a la persona.">
            <CredentialsCard {...credentials} />
          </DialogContent>
        ) : null}
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

function CreateAccountDialog({
  allowedRoles,
  onDone,
}: {
  allowedRoles: Role[];
  onDone: (account: CreatedAccountView) => void;
}) {
  const create = useCreateStaff();
  const form = useForm<CreateStaffInput>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', roles: ['TEACHER'] },
  });
  const { errors } = form.formState;
  const selectedRoles = (useWatch({ control: form.control, name: 'roles' }) ?? []) as Role[];
  return (
    <DialogContent
      title={allowedRoles.length > 1 ? 'Nueva cuenta' : 'Agregar maestro(a)'}
      description="Se crea su usuario y una contraseña temporal para entregarle."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => create.mutate(values, { onSuccess: onDone }))}
      >
        {create.isError ? <Alert>{errorMessage(create.error)}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="u-firstName" label="Nombre(s)" error={errors.firstName?.message}>
            <Input
              {...fieldProps('u-firstName', errors.firstName?.message)}
              {...form.register('firstName')}
            />
          </FormField>
          <FormField id="u-lastName" label="Apellidos" error={errors.lastName?.message}>
            <Input
              {...fieldProps('u-lastName', errors.lastName?.message)}
              {...form.register('lastName')}
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="u-phone" label="Teléfono (opcional)" error={errors.phone?.message}>
            <Input
              type="tel"
              inputMode="tel"
              {...fieldProps('u-phone', errors.phone?.message)}
              {...form.register('phone')}
            />
          </FormField>
          <FormField id="u-email" label="Correo (opcional)" error={errors.email?.message}>
            <Input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              {...fieldProps('u-email', errors.email?.message)}
              {...form.register('email')}
            />
          </FormField>
        </div>
        {allowedRoles.length > 1 ? (
          <RoleCheckboxes
            roles={allowedRoles}
            value={selectedRoles}
            onChange={(roles) =>
              form.setValue('roles', roles as (typeof STAFF_ROLES)[number][], {
                shouldValidate: true,
              })
            }
          />
        ) : null}
        {errors.roles?.message ? (
          <p className="text-sm text-destructive">{errors.roles.message}</p>
        ) : null}
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Crear cuenta
        </Button>
      </form>
    </DialogContent>
  );
}

function ManageUserDialog({
  user,
  allowedRoles,
  onDone,
  onReset,
}: {
  user: User;
  allowedRoles: Role[];
  onDone: () => void;
  onReset: (view: TemporaryPasswordView) => void;
}) {
  const { user: me } = useAuth();
  const [roles, setRoles] = useState<Role[]>(user.roles);
  const update = useUpdateUser();
  const disable = useUserAction('disable');
  const enable = useUserAction('enable');
  const reset = useResetUserPassword();
  const isMe = me?.id === user.id;

  return (
    <DialogContent title={fullName(user)} description={`Usuario ${user.username}`}>
      <div className="flex flex-col gap-5">
        {allowedRoles.length > 1 ? (
          <div className="flex flex-col gap-3">
            <RoleCheckboxes roles={allowedRoles} value={roles} onChange={setRoles} />
            <Button
              variant="outline"
              disabled={update.isPending || roles.length === 0}
              onClick={() => update.mutate({ id: user.id, roles }, { onSuccess: onDone })}
            >
              <ShieldCheck aria-hidden /> Guardar roles
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            disabled={reset.isPending || user.status !== 'ACTIVE'}
            onClick={() => {
              if (
                window.confirm(`¿Generar una contraseña temporal nueva para ${fullName(user)}?`)
              ) {
                reset.mutate(user.id, { onSuccess: onReset });
              }
            }}
          >
            <KeyRound aria-hidden /> Nueva contraseña temporal
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
            Desactivar y la contraseña temporal cierran todas sus sesiones abiertas. Para quitar a
            un maestro de un grupo, ve a Grupos → Maestros del grupo.
          </p>
        </div>
      </div>
    </DialogContent>
  );
}
