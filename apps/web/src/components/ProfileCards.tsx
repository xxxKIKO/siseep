import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatPhone,
  LOGO_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  ROLE_LABELS,
  type UpdateProfileInput,
  updateProfileSchema,
  type User,
} from '@siseep/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, KeyRound, LoaderCircle, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import {
  changePassword,
  myPhotoKey,
  removePhoto,
  updateProfile,
  uploadPhoto,
  useMyPhoto,
} from '@/api/account';
import { useAuth } from '@/auth/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { errorMessage, refreshSession } from '@/lib/api-client';
import { formatDateTime } from '@/lib/dates';
import { fieldProps } from '@/lib/form';

/** After a change to the own account, reload the session so the whole app sees it. */
function useReloadUser() {
  const { startSession } = useAuth();
  return async () => {
    const session = await refreshSession();
    if (session) startSession(session);
  };
}

/** Round photo or initials (header and profile). */
export function Avatar({ user, size = 40 }: { user: User; size?: number }) {
  const photo = useMyPhoto(Boolean(user.hasPhoto));
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size / 2.6 }}
      aria-hidden
    >
      {user.hasPhoto && photo.data ? (
        <img src={photo.data} alt="" className="size-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

export function ProfileCard({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const reload = useReloadUser();
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email ?? '',
      phone: user.phone ? formatPhone(user.phone) : '',
      address: user.address ?? '',
    },
  });
  const { errors, isDirty } = form.formState;
  const save = useMutation({
    mutationFn: updateProfile,
    onSuccess: async (saved) => {
      await reload();
      form.reset({
        firstName: saved.firstName,
        lastName: saved.lastName,
        email: saved.email ?? '',
        phone: saved.phone ? formatPhone(saved.phone) : '',
        address: saved.address ?? '',
      });
      toast.success('Perfil guardado.');
    },
  });
  const photo = useMutation({
    mutationFn: (file: File | null) => (file ? uploadPhoto(file) : removePhoto()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: myPhotoKey });
      await reload();
      toast.success('Foto actualizada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('La foto debe ser una imagen PNG o JPG.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('La foto debe pesar máximo 1 MB.');
      return;
    }
    photo.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mi perfil</CardTitle>
        <CardDescription>
          Usuario <span className="font-mono font-semibold text-primary">{user.username}</span> ·{' '}
          {user.roles.map((role) => ROLE_LABELS[role]).join(', ')}
          {user.lastLoginAt ? ` · último acceso ${formatDateTime(user.lastLoginAt)}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar user={user} size={80} />
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Elegir foto de perfil"
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={photo.isPending}
            >
              {photo.isPending ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Camera aria-hidden />
              )}
              {user.hasPhoto ? 'Cambiar foto' : 'Subir foto'}
            </Button>
            {user.hasPhoto ? (
              <Button variant="ghost" onClick={() => photo.mutate(null)} disabled={photo.isPending}>
                <Trash2 aria-hidden /> Quitar
              </Button>
            ) : null}
          </div>
        </div>

        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          {save.isError ? <Alert>{errorMessage(save.error)}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="p-firstName" label="Nombre(s)" error={errors.firstName?.message}>
              <Input
                {...fieldProps('p-firstName', errors.firstName?.message)}
                autoComplete="given-name"
                {...form.register('firstName')}
              />
            </FormField>
            <FormField id="p-lastName" label="Apellidos" error={errors.lastName?.message}>
              <Input
                {...fieldProps('p-lastName', errors.lastName?.message)}
                autoComplete="family-name"
                {...form.register('lastName')}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="p-email"
              label="Correo"
              hint="Opcional. Sirve para recuperar tu contraseña."
              error={errors.email?.message}
            >
              <Input
                {...fieldProps('p-email', errors.email?.message)}
                type="email"
                inputMode="email"
                autoComplete="email"
                {...form.register('email')}
              />
            </FormField>
            <FormField id="p-phone" label="Teléfono" error={errors.phone?.message}>
              <Input
                {...fieldProps('p-phone', errors.phone?.message)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                {...form.register('phone')}
              />
            </FormField>
          </div>
          <FormField id="p-address" label="Domicilio" error={errors.address?.message}>
            <Input
              {...fieldProps('p-address', errors.address?.message)}
              autoComplete="street-address"
              {...form.register('address')}
            />
          </FormField>
          <Button type="submit" className="self-start" disabled={save.isPending || !isDirty}>
            {save.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Guardar cambios
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      toast.success('Contraseña cambiada.');
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contraseña</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (next.length < PASSWORD_MIN_LENGTH) {
              setError(`La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
              return;
            }
            change.mutate();
          }}
        >
          {error || change.isError ? <Alert>{error ?? errorMessage(change.error)}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="pw-current" label="Contraseña actual">
              <PasswordInput
                id="pw-current"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </FormField>
            <FormField
              id="pw-next"
              label="Nueva contraseña"
              hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
            >
              <PasswordInput
                id="pw-next"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </FormField>
          </div>
          <Button
            type="submit"
            variant="outline"
            className="self-start"
            disabled={change.isPending || !current || !next}
          >
            {change.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <KeyRound aria-hidden />
            )}
            Cambiar contraseña
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
