import { zodResolver } from '@hookform/resolvers/zod';
import {
  emailSchema,
  formatGuardianCode,
  type GuardianCodePreview,
  guardianCodeSchema,
  PASSWORD_MIN_LENGTH,
  personNameSchema,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  relationshipSchema,
} from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { previewGuardianCode, registerGuardian, useRedeemCode } from '@/api/guardian';
import { useAuth } from '@/auth/auth-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { errorMessage, refreshSession } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import {
  newPasswordFields,
  PASSWORD_MISMATCH,
  passwordsMatch,
} from '@/pages/auth/password-confirmation';

const signUpSchema = z
  .object({
    firstName: personNameSchema,
    lastName: personNameSchema,
    email: emailSchema,
    relationship: relationshipSchema,
    acceptPrivacy: z.literal(true, { message: 'Para continuar acepta el aviso de privacidad' }),
    ...newPasswordFields,
  })
  .refine(passwordsMatch, PASSWORD_MISMATCH);
type SignUpValues = z.input<typeof signUpSchema>;

function PrivacyCheckbox({
  id,
  error,
  ...props
}: React.ComponentProps<'input'> & { error?: string }) {
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 items-start gap-3 text-sm">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-primary"
          aria-invalid={Boolean(error)}
          {...props}
        />
        <span>
          Leí y acepto el{' '}
          <Link to="/privacidad" target="_blank" className="font-medium text-primary underline">
            aviso de privacidad
          </Link>
          .
        </span>
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/**
 * /registro?codigo=XXXX — a parent confirms who the code links to ("Aguilar C. Edgar M., 5°B"),
 * then creates an account or, if already signed in, just links the child.
 */
export function GuardianSignUpPage() {
  const [params, setParams] = useSearchParams();
  const initialCode = params.get('codigo') ?? '';
  const [code, setCode] = useState(initialCode ? formatGuardianCode(initialCode) : '');
  const [preview, setPreview] = useState<{ code: string; data: GuardianCodePreview } | null>(null);
  const { status, user, startSession } = useAuth();
  const navigate = useNavigate();

  const check = useMutation({
    mutationFn: async (value: string) => {
      const parsed = guardianCodeSchema.safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Código no válido');
      return { code: parsed.data, data: await previewGuardianCode(parsed.data) };
    },
    onSuccess: (result) => {
      setPreview(result);
      setParams({ codigo: result.code }, { replace: true });
    },
  });

  if (!preview) {
    return (
      <AuthLayout
        title="Vincúlate con tu hijo(a)"
        description="Escribe el código de 8 caracteres que te dio la maestra."
        footer={
          <Link to="/privacidad" className="text-muted-foreground underline">
            Aviso de privacidad
          </Link>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            check.mutate(code);
          }}
        >
          {check.isError ? (
            <Alert>
              {check.error instanceof Error && !('status' in check.error)
                ? check.error.message
                : errorMessage(check.error)}
            </Alert>
          ) : null}
          <FormField id="code" label="Código">
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              placeholder="ABCD-2345"
              className="text-center font-mono text-xl tracking-widest"
              maxLength={12}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={check.isPending || !code.trim()}>
            {check.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Continuar
          </Button>
        </form>
      </AuthLayout>
    );
  }

  const who = (
    <div className="mb-4 rounded-lg border border-primary/20 bg-primary-soft p-4 text-sm">
      <p className="text-muted-foreground">Vas a vincularte con:</p>
      <p className="mt-1 text-lg font-semibold text-primary">
        {preview.data.studentName}, {preview.data.groupName}
      </p>
      <p className="text-muted-foreground">{preview.data.schoolName}</p>
      <button
        type="button"
        className="mt-2 min-h-11 text-sm font-medium text-primary underline"
        onClick={() => setPreview(null)}
      >
        No es mi hijo(a): usar otro código
      </button>
    </div>
  );

  if (status === 'authenticated' && user) {
    return (
      <AuthLayout title="Agregar a tu hijo(a)" description={`Sesión iniciada como ${user.email}.`}>
        {who}
        <RedeemForm
          code={preview.code}
          onDone={async () => {
            // New role or privacy acceptance: refresh the session to get the updated user.
            const session = await refreshSession();
            if (session) startSession(session);
            navigate('/padres', { replace: true });
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Crea tu cuenta"
      description="Con tu cuenta verás las calificaciones, notas y boletas de tu hijo(a)."
      footer={
        <span className="text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link
            to={`/iniciar-sesion?siguiente=${encodeURIComponent(`/registro?codigo=${preview.code}`)}`}
            className="font-medium text-primary underline"
          >
            Inicia sesión
          </Link>
        </span>
      }
    >
      {who}
      <SignUpForm
        code={preview.code}
        onDone={(session) => {
          startSession(session);
          navigate('/padres', { replace: true });
        }}
      />
    </AuthLayout>
  );
}

function SignUpForm({
  code,
  onDone,
}: {
  code: string;
  onDone: (session: Awaited<ReturnType<typeof registerGuardian>>) => void;
}) {
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      relationship: 'MADRE',
      password: '',
      confirmPassword: '',
    },
  });
  const mutation = useMutation({
    mutationFn: (values: SignUpValues) =>
      registerGuardian({
        code,
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        password: values.password,
        relationship: values.relationship,
        acceptPrivacy: true,
      }),
    onSuccess: onDone,
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
    >
      {mutation.isError ? <Alert>{errorMessage(mutation.error)}</Alert> : null}
      <FormField id="firstName" label="Tu nombre" error={errors.firstName?.message}>
        <Input
          {...fieldProps('firstName', errors.firstName?.message)}
          autoComplete="given-name"
          {...form.register('firstName')}
        />
      </FormField>
      <FormField id="lastName" label="Tus apellidos" error={errors.lastName?.message}>
        <Input
          {...fieldProps('lastName', errors.lastName?.message)}
          autoComplete="family-name"
          {...form.register('lastName')}
        />
      </FormField>
      <FormField id="relationship" label="Parentesco" error={errors.relationship?.message}>
        <Select id="relationship" {...form.register('relationship')}>
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABELS[r]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="email" label="Correo electrónico" error={errors.email?.message}>
        <Input
          {...fieldProps('email', errors.email?.message)}
          type="email"
          inputMode="email"
          autoComplete="email"
          {...form.register('email')}
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
      <PrivacyCheckbox
        id="acceptPrivacy"
        error={errors.acceptPrivacy?.message}
        {...form.register('acceptPrivacy')}
      />
      <Button type="submit" size="lg" disabled={mutation.isPending}>
        {mutation.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        Crear cuenta y vincular
      </Button>
    </form>
  );
}

/** Signed-in user: parentesco + privacy notice (accepted again with each child) and done. */
export function RedeemForm({ code, onDone }: { code: string; onDone: () => void | Promise<void> }) {
  const redeem = useRedeemCode();
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]>('MADRE');
  const [accepted, setAccepted] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | undefined>();
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!accepted) {
          setPrivacyError('Para continuar acepta el aviso de privacidad');
          return;
        }
        redeem.mutate(
          { code, relationship, acceptPrivacy: true },
          { onSuccess: () => void onDone() },
        );
      }}
    >
      {redeem.isError ? <Alert>{errorMessage(redeem.error)}</Alert> : null}
      <FormField id="relationship" label="Parentesco">
        <Select
          id="relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as typeof relationship)}
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABELS[r]}
            </option>
          ))}
        </Select>
      </FormField>
      <PrivacyCheckbox
        id="acceptPrivacy"
        checked={accepted}
        error={privacyError}
        onChange={(e) => {
          setAccepted(e.target.checked);
          setPrivacyError(undefined);
        }}
      />
      <Button type="submit" size="lg" disabled={redeem.isPending}>
        {redeem.isPending ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <CheckCircle2 aria-hidden />
        )}
        Vincular
      </Button>
    </form>
  );
}
