import { FIELD_COLORS, FIELD_NAMES } from '@siseep/shared';
import { LoaderCircle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useStudentGrades, useStudentNotes } from '@/api/capture';
import { useGroup } from '@/api/catalog';
import { useAuth } from '@/auth/auth-context';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { formatGrade } from '@/lib/capture';
import { formatDate } from '@/lib/dates';
import { COMPONENT_LABELS, SUBJECT_LABELS } from '@/lib/labels';
import { NoteDialog } from './NoteDialog';
import { StudentSummaryBars } from './StudentSummaryBars';
import { NotesList } from './NotesList';

/** /maestro/grupos/:groupId/alumnos/:studentId — grades of the period by field + notes. */
export function StudentFilePage() {
  const { groupId = '', studentId = '' } = useParams();
  const { user } = useAuth();
  const group = useGroup(groupId);
  const periodId = group.data?.currentPeriod?.id;
  const grades = useStudentGrades(studentId, periodId);
  const homeroom = group.data?.assignments.some(
    (a) => a.teacher.id === user?.id && a.scope === 'HOMEROOM',
  );
  const notes = useStudentNotes(studentId, periodId, Boolean(homeroom));
  const [writing, setWriting] = useState(false);

  if (grades.isLoading || group.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!grades.data)
    return (
      <p className="text-sm text-muted-foreground">No encontramos al alumno o no tienes acceso.</p>
    );
  const { student, fields } = grades.data;

  return (
    <div>
      <PageHeader
        title={student.fullName}
        description={`N/L ${student.listNumber} · Grupo ${student.groupName} · ${group.data?.currentPeriod?.name ?? ''}`}
        back={{
          to: `/maestro/grupos/${groupId}?campo=alumnos`,
          label: `Grupo ${student.groupName}`,
        }}
        actions={
          homeroom ? (
            <Button onClick={() => setWriting(true)}>
              <Plus aria-hidden /> Nota
            </Button>
          ) : null
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="grades-title" className="flex flex-col gap-3">
          {homeroom ? <StudentSummaryBars studentId={studentId} periodId={periodId} /> : null}
          <h2 id="grades-title" className="text-lg font-semibold">
            Calificaciones del periodo
          </h2>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay actividades.</p>
          ) : null}
          {fields.map((field) => (
            <Card key={field.fieldKey} className="overflow-hidden">
              <div
                className="h-1.5"
                style={{ backgroundColor: FIELD_COLORS[field.fieldKey] }}
                aria-hidden
              />
              <div className="p-4">
                <h3 className="mb-2 font-semibold">{FIELD_NAMES[field.fieldKey]}</h3>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {field.activities.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate">{a.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.subjectKey
                            ? SUBJECT_LABELS[a.subjectKey]
                            : COMPONENT_LABELS[a.component]}{' '}
                          · {formatDate(`${a.date}T12:00:00Z`, "d 'de' MMM")}
                        </span>
                      </span>
                      {a.grade ? (
                        <span className="text-base font-semibold tabular-nums">
                          {formatGrade(a.grade)}
                        </span>
                      ) : (
                        <Badge tone="warning">Pendiente</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}
        </section>
        {homeroom ? (
          <section aria-labelledby="notes-title" className="flex flex-col gap-3">
            <h2 id="notes-title" className="text-lg font-semibold">
              Notas
            </h2>
            <NotesList notes={notes.data} groupId={groupId} empty="Sin notas en este periodo." />
          </section>
        ) : null}
      </div>
      <Dialog open={writing} onOpenChange={setWriting}>
        {writing ? (
          <NoteDialog
            studentId={student.id}
            studentName={student.fullName}
            onDone={() => setWriting(false)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
