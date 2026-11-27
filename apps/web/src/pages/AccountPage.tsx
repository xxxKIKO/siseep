import { LOGO_MAX_BYTES, ROLE_LABELS, type User } from '@siseep/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, LoaderCircle, LogOut, MonitorSmartphone, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { myLogoKey, useMyLogo } from '@/api/closing';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-context';
import { InstallAppCard } from '@/components/InstallAppCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api-client';
import { formatDateTime } from '@/lib/dates';

export function AccountPage() {
  const { user, logout, logoutAll } = useAuth();
  const logoutAllMutation = useMutation({
    mutationFn: logoutAll,
    onSuccess: () => toast.success('Cerramos tu sesión en todos los dispositivos.'),
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!user) return null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Mi cuenta</h1>

      <Card>
        <CardHeader>
          <CardTitle>{`${user.firstName} ${user.lastName}`.trim()}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Roles</dt>
              <dd className="font-medium">
                {user.roles.map((role) => ROLE_LABELS[role]).join(', ')}
              </dd>
            </div>
            {user.lastLoginAt ? (
              <div>
                <dt className="text-muted-foreground">Último acceso</dt>
                <dd className="font-medium">{formatDateTime(user.lastLoginAt)}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {user.roles.includes('TEACHER') ? <TeacherLogoCard initial={Boolean(user.hasLogo)} /> : null}

      <InstallAppCard />

      <Card>
        <CardHeader>
          <CardTitle>Sesiones</CardTitle>
          <CardDescription>
            Si perdiste tu celular o entraste desde una computadora prestada, cierra la sesión en
            todos los dispositivos.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => logoutAllMutation.mutate()}
            disabled={logoutAllMutation.isPending}
          >
            {logoutAllMutation.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <MonitorSmartphone aria-hidden />
            )}
            Cerrar sesión en todos los dispositivos
          </Button>
          <Button variant="ghost" className="lg:hidden" onClick={() => void logout()}>
            <LogOut aria-hidden /> Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/** Logo of the homeroom teacher, printed at the right of the report card header. */
function TeacherLogoCard({ initial }: { initial: boolean }) {
  const queryClient = useQueryClient();
  const [hasLogo, setHasLogo] = useState(initial);
  const logo = useMyLogo(hasLogo);
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<User>('/me/logo', form, 'PUT');
    },
    onSuccess: async () => {
      setHasLogo(true);
      await queryClient.invalidateQueries({ queryKey: myLogoKey });
      toast.success('Logo actualizado.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<User>('/me/logo'),
    onSuccess: () => {
      setHasLogo(false);
      queryClient.removeQueries({ queryKey: myLogoKey });
      toast.success('Logo eliminado.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('El logo debe ser una imagen PNG o JPG.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('El logo debe pesar máximo 1 MB.');
      return;
    }
    upload.mutate(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo para las boletas</CardTitle>
        <CardDescription>
          Aparece a la derecha del encabezado de las boletas de tu grupo. PNG o JPG, máximo 1 MB.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div className="flex size-28 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40">
          {hasLogo && logo.data ? (
            <img src={logo.data} alt="Tu logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="px-3 text-center text-sm text-muted-foreground">Sin logo</span>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          aria-label="Elegir logo"
          onChange={(event) => {
            onFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <ImageUp aria-hidden />
            )}
            {hasLogo ? 'Cambiar logo' : 'Subir logo'}
          </Button>
          {hasLogo ? (
            <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
              <Trash2 aria-hidden /> Quitar
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
