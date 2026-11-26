import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_LENGTH } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { PasswordInput } from '@/components/ui/password-input';
import { api, errorMessage } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';
import { AuthLayout } from './AuthLayout';
import { newPasswordFields, PASSWORD_MISMATCH, passwordsMatch } from './password-confirmation';

const schema = z.object(newPasswordFields).refine(passwordsMatch, PASSWORD_MISMATCH);
type Values = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      api.post<void>('/auth/reset', { token, password: values.password }, { auth: false }),
  });
  const { errors } = form.formState;

  const loginLink = (
    <Link
      to="/iniciar-sesion"
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      Ir a iniciar sesión
    </Link>
  );

  if (!token) {
    return (
      <AuthLayout title="Enlace no válido" footer={loginLink}>
        <p className="text-sm">
          El enlace está incompleto. Ábrelo de nuevo desde el correo o{' '}
          <Link to="/olvide-contrasena" className="font-medium text-primary underline">
            pide uno nuevo
          </Link>
          .
        </p>
      </AuthLayout>
    );
  }

  if (mutation.isSuccess) {
    return (
      <AuthLayout title="Contraseña actualizada">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <CircleCheck className="size-10 text-primary" aria-hidden />
          <p className="text-sm">
            Ya puedes entrar con tu nueva contraseña. Por seguridad cerramos tus sesiones abiertas
            en otros dispositivos.
          </p>
          <Button asChild size="lg" className="w-full">
            <Link to="/iniciar-sesion">Iniciar sesión</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Elige una nueva contraseña"
      description={`Usa al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
      footer={loginLink}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {mutation.isError ? (
          <Alert>
            {errorMessage(mutation.error)}{' '}
            <Link to="/olvide-contrasena" className="font-medium underline">
              Pedir otro enlace
            </Link>
          </Alert>
        ) : null}
        <FormField id="password" label="Nueva contraseña" error={errors.password?.message}>
          <PasswordInput
            {...fieldProps('password', errors.password?.message)}
            autoComplete="new-password"
            {...form.register('password')}
          />
        </FormField>
        <FormField
          id="confirmPassword"
          label="Repite la contraseña"
          error={errors.confirmPassword?.message}
        >
          <PasswordInput
            {...fieldProps('confirmPassword', errors.confirmPassword?.message)}
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
        </FormField>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Guardar contraseña
        </Button>
      </form>
    </AuthLayout>
  );
}
