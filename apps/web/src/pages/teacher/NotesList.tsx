import { FIELD_NAMES, NOTE_KIND_LABELS, type NoteView } from '@siseep/shared';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useDeleteNote } from '@/api/capture';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/dates';
import { NoteDialog } from './NoteDialog';

const KIND_TONES = {
  ACADEMICO: 'primary',
  CONDUCTA: 'warning',
  RECONOCIMIENTO: 'success',
  SALUD: 'danger',
  OTRO: 'neutral',
} as const;

/** List of notes; with `showStudent`, each note links to the student's file. */
export function NotesList({
  notes,
  showStudent,
  groupId,
  empty,
}: {
  notes: NoteView[] | undefined;
  showStudent?: boolean;
  groupId: string;
  empty: string;
}) {
  const remove = useDeleteNote();
  const [editing, setEditing] = useState<NoteView | null>(null);

  if (!notes?.length)
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={KIND_TONES[note.kind]}>{NOTE_KIND_LABELS[note.kind]}</Badge>
              {note.fieldKey ? <Badge>{FIELD_NAMES[note.fieldKey]}</Badge> : null}
              <span className="flex items-center gap-1 text-muted-foreground">
                {note.visibleToGuardians ? (
                  <>
                    <Eye className="size-3.5" aria-hidden /> Visible para padres
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3.5" aria-hidden /> Solo personal
                  </>
                )}
              </span>
            </div>
            {showStudent ? (
              <Link
                to={`/maestro/grupos/${groupId}/alumnos/${note.student.id}`}
                className="mt-2 block text-sm font-semibold text-primary"
              >
                {note.student.listNumber ? `${note.student.listNumber}. ` : ''}
                {note.student.shortName}
              </Link>
            ) : null}
            <p className="mt-1 whitespace-pre-line text-sm">{note.text}</p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {formatDate(`${note.date}T12:00:00Z`, "d 'de' MMM")} · {note.author.name}
              </span>
              {note.canEdit ? (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Editar nota"
                    onClick={() => setEditing(note)}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Borrar nota"
                    disabled={remove.isPending}
                    onClick={() => window.confirm('¿Borrar esta nota?') && remove.mutate(note)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <NoteDialog
            studentId={editing.student.id}
            studentName={editing.student.shortName}
            note={editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </>
  );
}
