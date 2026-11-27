import { PASSWORD_MIN_LENGTH } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { changePassword } from '@/api/account';
import { useAuth } from '@/auth/auth-context';
import { homePathFor } from '@/auth/roles';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { PasswordInput } from '@/components/ui/password-input';
import { errorMessage, refreshSession } from '@/lib/api-client';
import { AuthLayout } from './AuthLayout';

/**
 * /cambiar-contrasena — first sign-in with a temporary password: choose your own (and, for
 * parents, accept the privacy notice). Nothing else works until this is done.
 */
export function ChangePasswordPage() {
  const { user, startSession, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardian = user?.roles.includes('GUARDIAN') ?? false;

  const mutation = useMutation({
    mutationFn: () =>
      changePassword({
        currentPassword: current,
        newPassword: next,
        ...(guardian ? { acceptPrivacy: accepted } : {}),
      }),
    onSuccess: async () => {
      // Refresh the session so the app sees the account without the temporary password.
      const session = await refreshSession();
      const fresh = session ? startSession(session) : user;
      navigate(fresh ? homePathFor(fresh.roles) : '/', { replace: true });
    },
  });

  if (!user) return null;

  return (
    <AuthLayout
      title="Elige tu contraseña"
      description={`Hola, ${user.firstName}. Tu usuario es ${user.username}. Cambia la contraseña temporal que te dieron por una tuya.`}
      footer={
        <button
          type="button"
          className="min-h-11 text-muted-foreground underline"
          onClick={() => void logout()}
        >
          Salir
        </button>
      }
    >
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
          if (next !== repeat) {
            setError('Las contraseñas no coinciden.');
            return;
          }
          if (guardian && !accepted) {
            setError('Para continuar acepta el aviso de privacidad.');
            return;
          }
          mutation.mutate();
        }}
      >
        {error || mutation.isError ? <Alert>{error ?? errorMessage(mutation.error)}</Alert> : null}
        <FormField id="current" label="Contraseña temporal">
          <PasswordInput
            id="current"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </FormField>
        <FormField
          id="next"
          label="Nueva contraseña"
          hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
        >
          <PasswordInput
            id="next"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </FormField>
        <FormField id="repeat" label="Repite la nueva contraseña">
          <PasswordInput
            id="repeat"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </FormField>
        {guardian ? (
          <label htmlFor="accept" className="flex min-h-11 items-start gap-3 text-sm">
            <input
              id="accept"
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span>
              Leí y acepto el{' '}
              <Link to="/privacidad" target="_blank" className="font-medium text-primary underline">
                aviso de privacidad
              </Link>
              .
            </span>
          </label>
        ) : null}
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Guardar y entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
