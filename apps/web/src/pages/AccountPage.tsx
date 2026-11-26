import { ROLE_LABELS } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle, LogOut, MonitorSmartphone } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/lib/api-client';
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
