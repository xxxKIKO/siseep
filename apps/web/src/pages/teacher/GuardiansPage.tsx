import { zodResolver } from '@hookform/resolvers/zod';
import {
  type CreatedAccountView,
  createGuardianSchema,
  type CreateGuardianInput,
  formatPhone,
  type GroupGuardianRow,
  type GuardianLinkView,
  MAX_GUARDIANS_PER_STUDENT,
  RELATIONSHIP_LABELS,
  RELATIONSHIPS,
  type TemporaryPasswordView,
} from '@siseep/shared';
import { KeyRound, LoaderCircle, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { useGroup } from '@/api/catalog';
import { useCreateGuardian, useGroupGuardians, useResetGuardianPassword } from '@/api/guardian';
import { usePortalBase } from '@/auth/ability';
import { CredentialsCard } from '@/components/CredentialsCard';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api-client';
import { fieldProps } from '@/lib/form';

type Student = GroupGuardianRow['student'];
type Result =
  | { kind: 'created'; account: CreatedAccountView; studentName: string }
  | { kind: 'reset'; account: TemporaryPasswordView; link: GuardianLinkView };

/**
 * /maestro/grupos/:groupId/padres (also /director/…): guardian accounts of each student. The
 * phone identifies the family: a sibling is added to the account that already has it.
 */
export function GuardiansPage() {
  const { groupId = '' } = useParams();
  const base = usePortalBase();
  const group = useGroup(groupId);
  const rows = useGroupGuardians(groupId);
  const reset = useResetGuardianPassword();
  const [adding, setAdding] = useState<Student | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  if (group.isLoading || rows.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!group.data || !rows.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Las cuentas de padres las crea el maestro titular del grupo o la dirección.
      </p>
    );
  }
  const list = rows.data;
  const linked = list.filter((r) => r.status === 'LINKED').length;

  return (
    <div>
      <PageHeader
        title={`Padres de familia · ${group.data.name}`}
        description={`${linked} de ${list.length} alumnos con un familiar con cuenta`}
        back={{ to: `${base}/grupos/${groupId}`, label: `Grupo ${group.data.name}` }}
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Crea la cuenta del papá, mamá o tutor desde su hijo(a). Si el teléfono ya está registrado
        con otro alumno de la escuela, se agrega a la misma cuenta: un solo usuario para todos sus
        hijos.
      </p>
      <ul className="flex flex-col gap-2">
        {list.map((row) => (
          <li key={row.student.id}>
            <Card className="flex flex-col gap-3 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 font-medium">
                  <span className="text-muted-foreground">{row.student.listNumber}.</span>{' '}
                  {row.student.fullName}
                </p>
                {row.links.length < MAX_GUARDIANS_PER_STUDENT ? (
                  <Button variant="outline" onClick={() => setAdding(row.student)}>
                    <UserPlus aria-hidden /> Agregar padre o tutor
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Máximo de 4 tutores</span>
                )}
              </div>
              {row.links.length ? (
                <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {row.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {link.guardian.name} ({RELATIONSHIP_LABELS[link.relationship]})
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{link.guardian.username}</span>
                          {link.guardian.phone ? (
                            <span>{formatPhone(link.guardian.phone)}</span>
                          ) : null}
                          <Badge tone={link.guardian.activated ? 'success' : 'warning'}>
                            {link.guardian.activated ? 'Ya entró' : 'Aún no entra'}
                          </Badge>
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={reset.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `¿Generar una nueva contraseña temporal para ${link.guardian.name}? La anterior dejará de funcionar.`,
                            )
                          )
                            return;
                          reset.mutate(link.guardian.id, {
                            onSuccess: (account) => setResult({ kind: 'reset', account, link }),
                          });
                        }}
                      >
                        <KeyRound aria-hidden /> Nueva contraseña
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Badge tone="neutral" className="self-start">
                  Sin padre o tutor con cuenta
                </Badge>
              )}
            </Card>
          </li>
        ))}
      </ul>

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        {adding ? (
          <GuardianForm
            groupId={groupId}
            student={adding}
            onDone={(account) => {
              setAdding(null);
              setResult({ kind: 'created', account, studentName: adding.fullName });
            }}
          />
        ) : null}
      </Dialog>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        {result?.kind === 'created' ? (
          <DialogContent
            title={result.account.existing ? 'Ya tenía cuenta' : 'Cuenta creada'}
            description={
              result.account.existing
                ? `Ese teléfono ya era de ${result.account.user.firstName} ${result.account.user.lastName}: ${result.studentName} se agregó a su misma cuenta.`
                : 'Entrega estos datos al padre o tutor.'
            }
          >
            {result.account.existing && result.account.children ? (
              <Alert variant="info" className="mb-3">
                Hijos en esta cuenta:{' '}
                {result.account.children.map((c) => `${c.fullName} (${c.groupName})`).join(', ')}
              </Alert>
            ) : null}
            <CredentialsCard
              name={`${result.account.user.firstName} ${result.account.user.lastName}`.trim()}
              username={result.account.username}
              temporaryPassword={result.account.temporaryPassword}
              phone={result.account.user.phone}
            />
          </DialogContent>
        ) : result?.kind === 'reset' ? (
          <DialogContent
            title="Nueva contraseña temporal"
            description="Entrégala al padre o tutor."
          >
            <CredentialsCard
              name={result.link.guardian.name}
              username={result.account.username}
              temporaryPassword={result.account.temporaryPassword}
              phone={result.link.guardian.phone}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function GuardianForm({
  groupId,
  student,
  onDone,
}: {
  groupId: string;
  student: Student;
  onDone: (account: CreatedAccountView) => void;
}) {
  const create = useCreateGuardian(groupId);
  const form = useForm<CreateGuardianInput>({
    resolver: zodResolver(createGuardianSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      phone: '',
      relationship: 'MADRE',
      address: '',
      email: '',
    },
  });
  const { errors } = form.formState;

  return (
    <DialogContent
      title="Agregar padre o tutor"
      description={`De ${student.fullName}. Si el teléfono ya está registrado, se vincula a esa cuenta.`}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          create.mutate({ studentId: student.id, input: values }, { onSuccess: onDone }),
        )}
      >
        {create.isError ? <Alert>{errorMessage(create.error)}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="g-firstName" label="Nombre(s)" error={errors.firstName?.message}>
            <Input
              {...fieldProps('g-firstName', errors.firstName?.message)}
              autoComplete="off"
              {...form.register('firstName')}
            />
          </FormField>
          <FormField id="g-lastName" label="Apellidos" error={errors.lastName?.message}>
            <Input
              {...fieldProps('g-lastName', errors.lastName?.message)}
              autoComplete="off"
              {...form.register('lastName')}
            />
          </FormField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id="g-phone"
            label="Teléfono celular"
            hint="10 dígitos. Identifica a la familia."
            error={errors.phone?.message}
          >
            <Input
              {...fieldProps('g-phone', errors.phone?.message)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="312 123 4567"
              {...form.register('phone')}
            />
          </FormField>
          <FormField id="g-relationship" label="Parentesco" error={errors.relationship?.message}>
            <Select id="g-relationship" {...form.register('relationship')}>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField id="g-address" label="Domicilio (opcional)" error={errors.address?.message}>
          <Input
            {...fieldProps('g-address', errors.address?.message)}
            autoComplete="off"
            {...form.register('address')}
          />
        </FormField>
        <FormField id="g-email" label="Correo (opcional)" error={errors.email?.message}>
          <Input
            {...fieldProps('g-email', errors.email?.message)}
            type="email"
            inputMode="email"
            autoComplete="off"
            {...form.register('email')}
          />
        </FormField>
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Crear cuenta
        </Button>
      </form>
    </DialogContent>
  );
}
