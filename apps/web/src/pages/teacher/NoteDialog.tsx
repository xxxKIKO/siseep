import { zodResolver } from '@hookform/resolvers/zod';
import {
  createNoteSchema,
  FIELD_KEYS,
  FIELD_NAMES,
  NOTE_KIND_LABELS,
  NOTE_KINDS,
  type NoteView,
} from '@siseep/shared';
import { LoaderCircle } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { useCreateNote, useUpdateNote } from '@/api/capture';
import { Button } from '@/components/ui/button';
import { DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { fieldProps } from '@/lib/form';
import { todayDateOnly } from '@/lib/labels';

type Form = z.input<typeof createNoteSchema>;

/** "+ Nota" (or edit an own note). Health notes can't be shown to guardians. */
export function NoteDialog({
  studentId,
  studentName,
  note,
  onDone,
}: {
  studentId: string;
  studentName: string;
  note?: NoteView;
  onDone: () => void;
}) {
  const create = useCreateNote();
  const update = useUpdateNote();
  const form = useForm<Form, unknown, z.output<typeof createNoteSchema>>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: {
      kind: note?.kind ?? 'ACADEMICO',
      text: note?.text ?? '',
      fieldKey: note?.fieldKey,
      date: note?.date ?? todayDateOnly(),
      visibleToGuardians: note?.visibleToGuardians ?? false,
    },
  });
  const { errors } = form.formState;
  const kind = useWatch({ control: form.control, name: 'kind' });
  const isHealth = kind === 'SALUD';
  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((values) => {
    const payload = { ...values, visibleToGuardians: isHealth ? false : values.visibleToGuardians };
    if (note) {
      update.mutate(
        { id: note.id, ...payload, fieldKey: payload.fieldKey ?? null },
        { onSuccess: onDone },
      );
    } else {
      create.mutate({ studentId, ...payload }, { onSuccess: onDone });
    }
  });

  return (
    <DialogContent title={note ? 'Editar nota' : 'Nueva nota'} description={studentName}>
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="note-kind" label="Tipo" error={errors.kind?.message}>
            <Select
              {...fieldProps('note-kind', errors.kind?.message)}
              {...form.register('kind', {
                onChange: (e: { target: { value: string } }) => {
                  if (e.target.value === 'SALUD') form.setValue('visibleToGuardians', false);
                },
              })}
            >
              {NOTE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {NOTE_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="note-date" label="Fecha" error={errors.date?.message}>
            <Input
              type="date"
              {...fieldProps('note-date', errors.date?.message)}
              {...form.register('date')}
            />
          </FormField>
        </div>
        <FormField id="note-field" label="Campo formativo (opcional)">
          <Select
            id="note-field"
            {...form.register('fieldKey', { setValueAs: (v: string) => v || undefined })}
          >
            <option value="">Ninguno</option>
            {FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {FIELD_NAMES[k]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="note-text" label="Nota" error={errors.text?.message}>
          <textarea
            {...fieldProps('note-text', errors.text?.message)}
            rows={4}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base"
            {...form.register('text')}
          />
        </FormField>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            disabled={isHealth}
            {...form.register('visibleToGuardians')}
          />
          <span>
            Visible para padres
            {isHealth ? (
              <span className="block text-xs text-muted-foreground">
                Las notas de salud nunca se muestran a los padres.
              </span>
            ) : null}
          </span>
        </label>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Guardar nota
        </Button>
      </form>
    </DialogContent>
  );
}
