import { zodResolver } from '@hookform/resolvers/zod';
import { createGroupSchema, type GroupView } from '@siseep/shared';
import { ChevronRight, LoaderCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { usePortalBase } from '@/auth/ability';
import { useCreateGroup, useGroups, useSchoolYears, useUsers } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { ResponsiveList } from '@/components/ResponsiveList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { fieldProps } from '@/lib/form';
import { SUBJECT_LABELS } from '@/lib/labels';

/** Admin: the group's configuration. Direction: its academic view (with a link to configure). */
const groupHref = (base: string, id: string) =>
  base === '/director' ? `${base}/grupos/${id}/configurar` : `${base}/grupos/${id}`;

export function GroupsPage() {
  const base = usePortalBase();
  const groups = useGroups();
  const [creating, setCreating] = useState(false);

  const subjectTeachers = (g: GroupView) =>
    g.assignments
      .filter((a) => a.scope === 'SUBJECT')
      .map((a) => `${a.teacher.name} (${a.subjectKey ? SUBJECT_LABELS[a.subjectKey] : ''})`)
      .join(', ');

  return (
    <div>
      <PageHeader
        title="Grupos"
        back={{ to: base, label: base === '/director' ? 'Tablero' : 'Administración' }}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Nuevo grupo
          </Button>
        }
      />
      <ResponsiveList
        label="Grupos"
        rows={groups.data}
        loading={groups.isLoading}
        rowKey={(g) => g.id}
        empty="Aún no hay grupos. Primero crea el ciclo escolar y después el grupo."
        columns={[
          { header: 'Grupo', cell: (g) => <span className="font-semibold">{g.name}</span> },
          { header: 'Ciclo', cell: (g) => g.schoolYearName },
          {
            header: 'Titular',
            cell: (g) =>
              g.homeroomTeacher?.name ?? <span className="text-muted-foreground">Sin asignar</span>,
          },
          { header: 'Materias', cell: (g) => subjectTeachers(g) || '—' },
          { header: 'Alumnos', cell: (g) => g.studentCount, className: 'text-right' },
          {
            header: 'Acciones',
            className: 'text-right',
            cell: (g) => (
              <Button variant="ghost" size="sm" asChild>
                <Link to={groupHref(base, g.id)}>Abrir</Link>
              </Button>
            ),
          },
        ]}
        card={(g) => (
          <Link to={groupHref(base, g.id)} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold">
                {g.name} <Badge>{g.schoolYearName}</Badge>
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {g.homeroomTeacher?.name ?? 'Sin titular'} · {g.studentCount} alumnos
              </p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        {creating ? <CreateGroupDialog onDone={() => setCreating(false)} /> : null}
      </Dialog>
    </div>
  );
}

function CreateGroupDialog({ onDone }: { onDone: () => void }) {
  const years = useSchoolYears();
  const teachers = useUsers({ role: 'TEACHER', limit: 200 });
  const create = useCreateGroup();
  const current = years.data?.find((y) => y.isCurrent) ?? years.data?.[0];
  const form = useForm<
    z.input<typeof createGroupSchema>,
    unknown,
    z.output<typeof createGroupSchema>
  >({
    resolver: zodResolver(createGroupSchema),
    values: {
      schoolYearId: current?.id ?? '',
      grade: 5,
      letter: 'A',
      homeroomTeacherId: undefined,
    },
  });
  const { errors } = form.formState;

  return (
    <DialogContent title="Nuevo grupo">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          create.mutate(
            { ...values, homeroomTeacherId: values.homeroomTeacherId || undefined },
            { onSuccess: onDone },
          ),
        )}
      >
        <FormField id="schoolYearId" label="Ciclo escolar" error={errors.schoolYearId?.message}>
          <Select
            {...fieldProps('schoolYearId', errors.schoolYearId?.message)}
            {...form.register('schoolYearId')}
          >
            {years.data?.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField id="grade" label="Grado" error={errors.grade?.message}>
            <Select
              {...fieldProps('grade', errors.grade?.message)}
              {...form.register('grade', { valueAsNumber: true })}
            >
              {[1, 2, 3, 4, 5, 6].map((g) => (
                <option key={g} value={g}>
                  {g}°
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="letter" label="Grupo (letra)" error={errors.letter?.message}>
            <Input
              {...fieldProps('letter', errors.letter?.message)}
              maxLength={1}
              autoCapitalize="characters"
              {...form.register('letter')}
            />
          </FormField>
        </div>
        <FormField
          id="homeroomTeacherId"
          label="Maestro(a) titular"
          error={errors.homeroomTeacherId?.message}
        >
          <Select
            {...fieldProps('homeroomTeacherId', errors.homeroomTeacherId?.message)}
            {...form.register('homeroomTeacherId', { setValueAs: (v: string) => v || undefined })}
          >
            <option value="">Sin asignar por ahora</option>
            {teachers.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.firstName} ${t.lastName}`.trim()} · {t.email}
              </option>
            ))}
          </Select>
        </FormField>
        <Button type="submit" size="lg" disabled={create.isPending || !current}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Crear grupo
        </Button>
      </form>
    </DialogContent>
  );
}
