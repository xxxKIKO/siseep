import { zodResolver } from '@hookform/resolvers/zod';
import { type ForgotPasswordInput, forgotPasswordSchema } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle, MailCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';
import { AuthLayout } from './AuthLayout';

export function ForgotPasswordPage() {
  const form = useForm({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: ForgotPasswordInput) =>
      api.post<void>('/auth/forgot', values, { auth: false }),
  });
  const { errors } = form.formState;

  const backToLogin = (
    <Link
      to="/iniciar-sesion"
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      Volver a iniciar sesión
    </Link>
  );

  if (mutation.isSuccess) {
    return (
      <AuthLayout title="Revisa tu correo" footer={backToLogin}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="size-10 text-primary" aria-hidden />
          <p className="text-sm">
            Si <strong>{mutation.variables.email}</strong> está registrado, te enviamos un enlace
            para elegir una nueva contraseña. El enlace vence en 1 hora.
          </p>
          <p className="text-xs text-muted-foreground">
            ¿No llegó? Revisa la carpeta de correo no deseado.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Olvidé mi contraseña"
      description="Escribe tu correo y te enviaremos un enlace para restablecerla."
      footer={backToLogin}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {mutation.isError ? <Alert>{errorMessage(mutation.error)}</Alert> : null}
        <FormField id="email" label="Correo electrónico" error={errors.email?.message}>
          <Input
            {...fieldProps('email', errors.email?.message)}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            {...form.register('email')}
          />
        </FormField>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Enviar enlace
        </Button>
      </form>
    </AuthLayout>
  );
}
