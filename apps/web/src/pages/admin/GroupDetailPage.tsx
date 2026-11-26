import { SUBJECT_KEYS, type SubjectKey } from '@siseep/shared';
import { LoaderCircle, Search, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import {
  useAddAssignment,
  useCreateStudent,
  useEnroll,
  useGroup,
  useRemoveAssignment,
  useRoster,
  useStudents,
  useUsers,
} from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { RosterList } from '@/components/RosterList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SUBJECT_LABELS } from '@/lib/labels';

export function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const group = useGroup(groupId);
  const roster = useRoster(groupId);
  const [enrolling, setEnrolling] = useState(false);

  if (group.isLoading)
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  if (!group.data) return <p className="text-sm text-muted-foreground">No encontramos el grupo.</p>;
  const g = group.data;
  const nextListNumber =
    Math.max(
      0,
      ...(roster.data ?? []).filter((e) => e.status === 'ACTIVE').map((e) => e.listNumber),
    ) + 1;

  return (
    <div>
      <PageHeader
        title={`Grupo ${g.name}`}
        description={`Ciclo ${g.schoolYearName}${g.currentPeriod ? ` · ${g.currentPeriod.name}` : ''} · ${g.studentCount} alumnos`}
        back={{ to: '/admin/grupos', label: 'Grupos' }}
        actions={
          <Button onClick={() => setEnrolling(true)}>
            <UserPlus aria-hidden /> Inscribir alumno
          </Button>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Assignments groupId={g.id} assignments={g.assignments} />
        <Card>
          <CardHeader>
            <CardTitle>Lista del grupo</CardTitle>
          </CardHeader>
          <CardContent>
            <RosterList entries={roster.data} loading={roster.isLoading} />
          </CardContent>
        </Card>
      </div>
      <Dialog open={enrolling} onOpenChange={setEnrolling}>
        {enrolling ? (
          <EnrollDialog
            groupId={g.id}
            groupName={g.name}
            suggestedNumber={nextListNumber}
            onDone={() => setEnrolling(false)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function Assignments({
  groupId,
  assignments,
}: {
  groupId: string;
  assignments: NonNullable<ReturnType<typeof useGroup>['data']>['assignments'];
}) {
  const teachers = useUsers({ role: 'TEACHER', limit: 200 });
  const add = useAddAssignment(groupId);
  const remove = useRemoveAssignment(groupId);
  const [teacherId, setTeacherId] = useState('');
  const [scope, setScope] = useState<'HOMEROOM' | SubjectKey>('HOMEROOM');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Maestros</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{a.teacher.name}</p>
                <Badge tone={a.scope === 'HOMEROOM' ? 'primary' : 'neutral'}>
                  {a.scope === 'HOMEROOM'
                    ? 'Titular'
                    : `Materia: ${a.subjectKey ? SUBJECT_LABELS[a.subjectKey] : ''}`}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar a ${a.teacher.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(a.id)}
              >
                <Trash2 aria-hidden />
              </Button>
            </li>
          ))}
          {assignments.length === 0 ? (
            <li className="text-sm text-muted-foreground">Sin maestros asignados.</li>
          ) : null}
        </ul>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Label htmlFor="assign-teacher">Asignar maestro(a)</Label>
          <Select
            id="assign-teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
          >
            <option value="">Elige una persona…</option>
            {teachers.data?.items.map((t) => (
              <option key={t.id} value={t.id}>
                {`${t.firstName} ${t.lastName}`.trim()}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Tipo de asignación"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="HOMEROOM">Titular del grupo (todas las materias)</option>
            {SUBJECT_KEYS.map((key) => (
              <option key={key} value={key}>
                Solo {SUBJECT_LABELS[key]}
              </option>
            ))}
          </Select>
          <Button
            disabled={!teacherId || add.isPending}
            onClick={() =>
              add.mutate(
                scope === 'HOMEROOM'
                  ? { teacherId, scope: 'HOMEROOM' }
                  : { teacherId, scope: 'SUBJECT', subjectKey: scope },
                { onSuccess: () => setTeacherId('') },
              )
            }
          >
            {add.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Asignar
          </Button>
          <p className="text-xs text-muted-foreground">
            Si ya hay titular, el nuevo lo reemplaza. Los maestros de materia solo ven su materia.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EnrollDialog({
  groupId,
  groupName,
  suggestedNumber,
  onDone,
}: {
  groupId: string;
  groupName: string;
  suggestedNumber: number;
  onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [listNumber, setListNumber] = useState(suggestedNumber);
  const [newStudent, setNewStudent] = useState({ lastName1: '', lastName2: '', firstName: '' });
  const students = useStudents({ q });
  const enroll = useEnroll();
  const create = useCreateStudent();

  const enrollExisting = (studentId: string) =>
    enroll.mutate({ studentId, groupId, listNumber }, { onSuccess: onDone });
  const createAndEnroll = () =>
    create.mutate(newStudent, {
      onSuccess: (student) => enrollExisting(student.id),
    });

  return (
    <DialogContent
      title={`Inscribir en ${groupName}`}
      description="Busca al alumno; si no existe, dalo de alta aquí mismo."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="listNumber">Número de lista (N/L)</Label>
          <Input
            id="listNumber"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            value={listNumber}
            onChange={(e) => setListNumber(Number(e.target.value))}
          />
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Buscar alumno"
            placeholder="Buscar por apellido o nombre"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {q.trim().length >= 2 ? (
          <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
            {students.data?.items.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.fullName}</p>
                  {s.enrollment ? (
                    <p className="text-xs text-muted-foreground">
                      {s.enrollment.groupName} · N/L {s.enrollment.listNumber}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enroll.isPending}
                  onClick={() => enrollExisting(s.id)}
                >
                  Inscribir
                </Button>
              </li>
            ))}
            {students.data?.items.length === 0 ? (
              <li className="text-sm text-muted-foreground">Sin resultados.</li>
            ) : null}
          </ul>
        ) : null}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm font-medium">Alumno nuevo</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              aria-label="Apellido paterno"
              placeholder="Apellido paterno"
              value={newStudent.lastName1}
              onChange={(e) => setNewStudent({ ...newStudent, lastName1: e.target.value })}
            />
            <Input
              aria-label="Apellido materno"
              placeholder="Apellido materno"
              value={newStudent.lastName2}
              onChange={(e) => setNewStudent({ ...newStudent, lastName2: e.target.value })}
            />
            <Input
              aria-label="Nombre(s)"
              placeholder="Nombre(s)"
              value={newStudent.firstName}
              onChange={(e) => setNewStudent({ ...newStudent, firstName: e.target.value })}
            />
          </div>
          <Button
            disabled={
              !newStudent.lastName1.trim() ||
              !newStudent.firstName.trim() ||
              create.isPending ||
              enroll.isPending
            }
            onClick={createAndEnroll}
          >
            {create.isPending || enroll.isPending ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : null}
            Dar de alta e inscribir con N/L {listNumber}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
