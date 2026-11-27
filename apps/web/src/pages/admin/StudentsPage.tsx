import { zodResolver } from '@hookform/resolvers/zod';
import { createStudentSchema, RELATIONSHIP_LABELS, type StudentView } from '@siseep/shared';
import { LoaderCircle, Pencil, Plus, Search, Unlink } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import {
  useCreateStudent,
  useStudents,
  useUpdateEnrollment,
  useUpdateStudent,
} from '@/api/catalog';
import { useRevokeGuardian, useStudentGuardians } from '@/api/guardian';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiveList } from '@/components/ResponsiveList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { formatDate } from '@/lib/dates';
import { fieldProps } from '@/lib/form';
import { ENROLLMENT_STATUS_LABELS } from '@/lib/labels';

export function StudentsPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const deferredQ = useDeferredValue(q);
  const students = useStudents({ q: deferredQ, page });
  const [editing, setEditing] = useState<StudentView | 'new' | null>(null);
  const total = students.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 30));

  const enrollmentBadge = (s: StudentView) =>
    s.enrollment ? (
      <Badge tone={s.enrollment.status === 'ACTIVE' ? 'primary' : 'neutral'}>
        {s.enrollment.groupName} · N/L {s.enrollment.listNumber}
        {s.enrollment.status !== 'ACTIVE'
          ? ` · ${ENROLLMENT_STATUS_LABELS[s.enrollment.status as keyof typeof ENROLLMENT_STATUS_LABELS]}`
          : ''}
      </Badge>
    ) : (
      <Badge tone="warning">Sin grupo</Badge>
    );

  return (
    <div>
      <PageHeader
        title="Alumnos"
        description={students.data ? `${total} alumnos` : undefined}
        back={{ to: '/admin', label: 'Administración' }}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Alta de alumno
          </Button>
        }
      />
      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Buscar alumno"
          placeholder="Buscar por apellido o nombre (sin acentos también)"
          className="pl-9"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <ResponsiveList
        label="Alumnos"
        rows={students.data?.items}
        loading={students.isLoading}
        rowKey={(s) => s.id}
        empty={
          q
            ? 'No encontramos alumnos con esa búsqueda.'
            : 'Aún no hay alumnos. Dalos de alta o importa el Excel del grupo.'
        }
        columns={[
          { header: 'Alumno', cell: (s) => <span className="font-medium">{s.fullName}</span> },
          { header: 'Grupo', cell: enrollmentBadge },
          { header: 'CURP', cell: (s) => s.curp ?? '—' },
          {
            header: 'Acciones',
            className: 'text-right',
            cell: (s) => (
              <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                <Pencil aria-hidden /> Editar
              </Button>
            ),
          },
        ]}
        card={(s) => (
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setEditing(s)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.fullName}</span>
              <span className="mt-1 block">{enrollmentBadge(s)}</span>
            </span>
            <Pencil className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        )}
      />
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page} de {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </Button>
        </div>
      ) : null}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <StudentDialog
            student={editing === 'new' ? undefined : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

type StudentForm = z.input<typeof createStudentSchema>;

function StudentDialog({ student, onDone }: { student?: StudentView; onDone: () => void }) {
  const create = useCreateStudent();
  const update = useUpdateStudent();
  const updateEnrollment = useUpdateEnrollment();
  const form = useForm<StudentForm, unknown, z.output<typeof createStudentSchema>>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      lastName1: student?.lastName1 ?? '',
      lastName2: student?.lastName2 ?? '',
      firstName: student?.firstName ?? '',
      curp: student?.curp ?? '',
      birthDate: student?.birthDate ?? '',
      notes: student?.notes ?? '',
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;

  return (
    <DialogContent
      title={student ? student.fullName : 'Alta de alumno'}
      description="La CURP y la fecha de nacimiento son opcionales."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          student
            ? update.mutate({ id: student.id, ...values }, { onSuccess: onDone })
            : create.mutate(values, { onSuccess: onDone }),
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="lastName1" label="Apellido paterno" error={errors.lastName1?.message}>
            <Input
              {...fieldProps('lastName1', errors.lastName1?.message)}
              {...form.register('lastName1')}
            />
          </FormField>
          <FormField id="lastName2" label="Apellido materno" error={errors.lastName2?.message}>
            <Input
              {...fieldProps('lastName2', errors.lastName2?.message)}
              {...form.register('lastName2')}
            />
          </FormField>
        </div>
        <FormField id="firstName" label="Nombre(s)" error={errors.firstName?.message}>
          <Input
            {...fieldProps('firstName', errors.firstName?.message)}
            {...form.register('firstName')}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="curp" label="CURP (opcional)" error={errors.curp?.message}>
            <Input
              {...fieldProps('curp', errors.curp?.message)}
              autoCapitalize="characters"
              {...form.register('curp')}
            />
          </FormField>
          <FormField
            id="birthDate"
            label="Fecha de nacimiento (opcional)"
            error={errors.birthDate?.message}
          >
            <Input
              type="date"
              {...fieldProps('birthDate', errors.birthDate?.message)}
              {...form.register('birthDate')}
            />
          </FormField>
        </div>
        {student?.enrollment ? (
          <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-3">
            <Label htmlFor="enrollment-status">
              Inscripción en {student.enrollment.groupName} (N/L {student.enrollment.listNumber})
            </Label>
            <Select
              id="enrollment-status"
              defaultValue={student.enrollment.status}
              disabled={updateEnrollment.isPending}
              onChange={(e) =>
                updateEnrollment.mutate({
                  id: student.enrollment!.id,
                  status: e.target.value as keyof typeof ENROLLMENT_STATUS_LABELS,
                })
              }
            >
              {Object.entries(ENROLLMENT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {student ? 'Guardar cambios' : 'Dar de alta'}
        </Button>
      </form>
      {student ? <StudentGuardians studentId={student.id} /> : null}
    </DialogContent>
  );
}

/** Guardians linked to the student; the admin can unlink them (stays in the audit log). */
function StudentGuardians({ studentId }: { studentId: string }) {
  const guardians = useStudentGuardians(studentId);
  const revoke = useRevokeGuardian(studentId);
  return (
    <section aria-labelledby="guardians-title" className="mt-5 border-t border-border pt-4">
      <h3 id="guardians-title" className="mb-2 font-semibold">
        Padres o tutores vinculados
      </h3>
      {guardians.isLoading ? (
        <LoaderCircle className="size-5 animate-spin text-primary" aria-label="Cargando" />
      ) : guardians.data?.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {guardians.data.map((link) => (
            <li key={link.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {link.guardian.name} ({RELATIONSHIP_LABELS[link.relationship]})
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {link.guardian.email} · desde {formatDate(link.linkedAt, "d 'de' MMM yyyy")}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={revoke.isPending}
                onClick={() => {
                  if (
                    window.confirm(`¿Desvincular a ${link.guardian.name}? Dejará de ver al alumno.`)
                  ) {
                    revoke.mutate(link.id);
                  }
                }}
              >
                <Unlink aria-hidden /> Desvincular
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ningún familiar vinculado. El maestro titular genera los códigos desde "Padres de
          familia".
        </p>
      )}
    </section>
  );
}
