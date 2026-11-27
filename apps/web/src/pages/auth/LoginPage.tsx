import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { useAuth } from '@/auth/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { errorMessage } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { login } = useAuth();
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });
  // On success GuestOnly redirects to `?siguiente=` or the user's portal.
  const mutation = useMutation({ mutationFn: login });
  const { errors } = form.formState;

  return (
    <AuthLayout
      title="Iniciar sesión"
      description="Entra con el usuario que te dio la escuela (por ejemplo MAE26-0001)."
      footer={
        <span className="flex flex-col gap-2 text-muted-foreground">
          <span>
            ¿Eres mamá, papá o tutor y te dieron un código?{' '}
            <Link to="/registro" className="font-medium text-primary underline">
              Regístrate
            </Link>
          </span>
          <Link to="/privacidad" className="underline">
            Aviso de privacidad
          </Link>
        </span>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {mutation.isError ? <Alert>{errorMessage(mutation.error)}</Alert> : null}

        <FormField id="username" label="Usuario" error={errors.username?.message}>
          <Input
            {...fieldProps('username', errors.username?.message)}
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="MAE26-0001"
            {...form.register('username')}
          />
        </FormField>

        <FormField id="password" label="Contraseña" error={errors.password?.message}>
          <PasswordInput
            {...fieldProps('password', errors.password?.message)}
            autoComplete="current-password"
            {...form.register('password')}
          />
        </FormField>

        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Entrar
        </Button>

        <Link
          to="/olvide-contrasena"
          className="self-center py-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Olvidé mi contraseña
        </Link>
      </form>
    </AuthLayout>
  );
}
