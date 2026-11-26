import { zodResolver } from '@hookform/resolvers/zod';
import { type AuthResponse, PASSWORD_MIN_LENGTH, personNameSchema } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/auth/auth-context';
import { homePathFor } from '@/auth/roles';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { api, errorMessage } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';
import { AuthLayout } from './AuthLayout';
import { newPasswordFields, PASSWORD_MISMATCH, passwordsMatch } from './password-confirmation';

const schema = z
  .object({ firstName: personNameSchema, lastName: personNameSchema, ...newPasswordFields })
  .refine(passwordsMatch, PASSWORD_MISMATCH);
type Values = z.infer<typeof schema>;

/** Staff sign-up from the link an admin sent by email (`/invitacion?codigo=…`). */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('codigo') ?? '';
  const navigate = useNavigate();
  const { startSession } = useAuth();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', password: '', confirmPassword: '' },
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      api.post<AuthResponse>(
        '/auth/accept-invite',
        {
          code,
          firstName: values.firstName,
          lastName: values.lastName,
          password: values.password,
        },
        { auth: false },
      ),
    onSuccess: (session) => {
      const user = startSession(session);
      navigate(homePathFor(user.roles), { replace: true });
    },
  });
  const { errors } = form.formState;

  if (!code) {
    return (
      <AuthLayout title="Invitación no válida">
        <p className="text-sm">
          El enlace está incompleto. Ábrelo de nuevo desde el correo de invitación o pide a la
          administración que te envíe uno nuevo.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      description="Te invitaron al sistema de evaluación de la escuela. Completa tus datos."
      footer={
        <span className="text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link to="/iniciar-sesion" className="font-medium text-primary underline">
            Inicia sesión
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
        <FormField id="firstName" label="Nombre(s)" error={errors.firstName?.message}>
          <Input
            {...fieldProps('firstName', errors.firstName?.message)}
            autoComplete="given-name"
            {...form.register('firstName')}
          />
        </FormField>
        <FormField id="lastName" label="Apellidos" error={errors.lastName?.message}>
          <Input
            {...fieldProps('lastName', errors.lastName?.message)}
            autoComplete="family-name"
            {...form.register('lastName')}
          />
        </FormField>
        <FormField
          id="password"
          label="Contraseña"
          hint={`Al menos ${PASSWORD_MIN_LENGTH} caracteres.`}
          error={errors.password?.message}
        >
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
          Crear cuenta
        </Button>
      </form>
    </AuthLayout>
  );
}
