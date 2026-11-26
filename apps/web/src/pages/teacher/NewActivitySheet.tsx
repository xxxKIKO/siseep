import { zodResolver } from '@hookform/resolvers/zod';
import {
  ACTIVITY_MEDIUMS,
  type Component,
  COMPONENTS,
  createActivitySchema,
  FIELD_COLORS,
  FIELD_KEYS,
  FIELD_NAMES,
  type FieldKey,
  type SubjectKey,
} from '@siseep/shared';
import { LoaderCircle } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { useCreateActivity } from '@/api/capture';
import { DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { fieldProps } from '@/lib/form';
import {
  COMPLEMENTARY_BY_FIELD,
  COMPONENT_LABELS,
  SUBJECT_LABELS,
  todayDateOnly,
} from '@/lib/labels';
import { cn } from '@/lib/utils';

type Form = z.input<typeof createActivitySchema>;

interface NewActivitySheetProps {
  groupId: string;
  periodId: string;
  defaultField: FieldKey;
  /** Subject teachers only create activities of their subject. */
  onlySubject?: SubjectKey;
}

/** Bottom sheet "Nueva actividad": 3 required fields, today's date prefilled; opens capture. */
export function NewActivitySheet({
  groupId,
  periodId,
  defaultField,
  onlySubject,
}: NewActivitySheetProps) {
  const navigate = useNavigate();
  const create = useCreateActivity();
  const subjectField = onlySubject
    ? (Object.entries(COMPLEMENTARY_BY_FIELD).find(([, s]) => s === onlySubject)?.[0] as FieldKey)
    : undefined;
  const form = useForm<Form, unknown, z.output<typeof createActivitySchema>>({
    resolver: zodResolver(createActivitySchema),
    defaultValues: {
      groupId,
      periodId,
      fieldKey: subjectField ?? defaultField,
      component: onlySubject ? 'COMPLEMENTARIA' : 'DESEMPENO',
      subjectKey: onlySubject,
      name: '',
      date: todayDateOnly(),
      medium: '',
      description: '',
      visibleToGuardians: true,
    },
  });
  const { errors } = form.formState;
  const fieldKey = useWatch({ control: form.control, name: 'fieldKey' }) as FieldKey;
  const component = useWatch({ control: form.control, name: 'component' }) as Component;
  const complementary = COMPLEMENTARY_BY_FIELD[fieldKey];
  const components = COMPONENTS.filter((c) => c !== 'COMPLEMENTARIA' || complementary);

  const pickComponent = (value: Component) => {
    form.setValue('component', value, { shouldValidate: false });
    form.setValue('subjectKey', value === 'COMPLEMENTARIA' ? complementary : undefined);
  };
  const pickField = (value: FieldKey) => {
    form.setValue('fieldKey', value);
    if (component === 'COMPLEMENTARIA') {
      const subject = COMPLEMENTARY_BY_FIELD[value];
      if (subject) form.setValue('subjectKey', subject);
      else pickComponent('DESEMPENO');
    }
  };

  return (
    <DialogContent title="Nueva actividad" description="Al guardar se abre la captura.">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) =>
          create.mutate(values, {
            onSuccess: (activity) => navigate(`/maestro/actividades/${activity.id}`),
          }),
        )}
      >
        {!onlySubject ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Campo formativo</legend>
            <div className="grid grid-cols-2 gap-2">
              {FIELD_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={fieldKey === key}
                  onClick={() => pickField(key)}
                  className={cn(
                    'min-h-11 rounded-md border-2 px-2 py-1 text-left text-sm font-medium leading-tight',
                    fieldKey === key
                      ? 'border-primary bg-primary-soft'
                      : 'border-transparent bg-muted/60',
                  )}
                  style={{ borderLeftColor: FIELD_COLORS[key], borderLeftWidth: 6 }}
                >
                  {FIELD_NAMES[key]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {!onlySubject ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Componente</legend>
            <div className="flex flex-wrap gap-2">
              {components.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={component === c}
                  onClick={() => pickComponent(c)}
                  className={cn(
                    'min-h-11 rounded-full border px-4 text-sm font-medium',
                    component === c
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-card',
                  )}
                >
                  {c === 'COMPLEMENTARIA' && complementary
                    ? SUBJECT_LABELS[complementary]
                    : COMPONENT_LABELS[c]}
                </button>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-muted-foreground">
            {FIELD_NAMES[fieldKey]} · {SUBJECT_LABELS[onlySubject]}
          </p>
        )}

        <FormField id="activity-name" label="Nombre" error={errors.name?.message}>
          <Input
            {...fieldProps('activity-name', errors.name?.message)}
            autoFocus
            placeholder="Ej. Tabla del 7"
            enterKeyHint="done"
            {...form.register('name')}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="activity-date" label="Fecha" error={errors.date?.message}>
            <Input
              type="date"
              {...fieldProps('activity-date', errors.date?.message)}
              {...form.register('date')}
            />
          </FormField>
          <FormField id="activity-medium" label="Medio (opcional)" error={errors.medium?.message}>
            <Input
              {...fieldProps('activity-medium', errors.medium?.message)}
              list="activity-mediums"
              placeholder="Libreta"
              {...form.register('medium')}
            />
          </FormField>
          <datalist id="activity-mediums">
            {ACTIVITY_MEDIUMS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <FormField
          id="activity-description"
          label="Descripción (opcional)"
          error={errors.description?.message}
        >
          <textarea
            {...fieldProps('activity-description', errors.description?.message)}
            rows={2}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base"
            {...form.register('description')}
          />
        </FormField>
        {errors.subjectKey?.message ? (
          <p className="text-sm text-destructive">{errors.subjectKey.message}</p>
        ) : null}
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Guardar y capturar
        </Button>
      </form>
    </DialogContent>
  );
}
