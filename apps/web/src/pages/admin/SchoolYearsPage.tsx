import { zodResolver } from '@hookform/resolvers/zod';
import {
  createPeriodSchema,
  createSchoolYearSchema,
  type PeriodView,
  type SchoolYearView,
} from '@siseep/shared';
import { CalendarPlus, LoaderCircle, Pencil, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import {
  useCreatePeriod,
  useCreateSchoolYear,
  usePeriods,
  useSchoolYears,
  useUpdatePeriod,
  useUpdateSchoolYear,
} from '@/api/catalog';
import { usePortalBase } from '@/auth/ability';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/dates';
import { fieldProps } from '@/lib/form';
import { PERIOD_STATUS_LABELS } from '@/lib/labels';

const shortDate = (value: string) => formatDate(`${value}T12:00:00Z`, "d 'de' MMM yyyy");

export function SchoolYearsPage() {
  const base = usePortalBase();
  const years = useSchoolYears();
  const periods = usePeriods();
  const [creatingYear, setCreatingYear] = useState(false);

  return (
    <div>
      <PageHeader
        title="Ciclos y periodos"
        description="Cada ciclo tiene sus periodos y sus reglas de cálculo."
        back={{ to: base, label: base === '/director' ? 'Tablero' : 'Administración' }}
        actions={
          <Button onClick={() => setCreatingYear(true)}>
            <Plus aria-hidden /> Nuevo ciclo
          </Button>
        }
      />
      {years.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : years.data?.length ? (
        <div className="flex flex-col gap-4">
          {years.data.map((year) => (
            <YearCard
              key={year.id}
              year={year}
              periods={(periods.data ?? []).filter((p) => p.schoolYearId === year.id)}
            />
          ))}
        </div>
      ) : (
        <Card className="px-5 py-10 text-center text-sm text-muted-foreground">
          Aún no hay ciclos escolares. Crea el ciclo 2026-2027 para empezar.
        </Card>
      )}
      <Dialog open={creatingYear} onOpenChange={setCreatingYear}>
        {creatingYear ? <CreateYearDialog onDone={() => setCreatingYear(false)} /> : null}
      </Dialog>
    </div>
  );
}

function YearCard({ year, periods }: { year: SchoolYearView; periods: PeriodView[] }) {
  const base = usePortalBase();
  const updateYear = useUpdateSchoolYear();
  const [periodDialog, setPeriodDialog] = useState<PeriodView | 'new' | null>(null);
  const nextNumber = [1, 2, 3].find((n) => !periods.some((p) => p.number === n));

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            Ciclo {year.name} {year.isCurrent ? <Badge tone="primary">Actual</Badge> : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {shortDate(year.startDate)} – {shortDate(year.endDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!year.isCurrent ? (
            <Button
              variant="outline"
              size="sm"
              disabled={updateYear.isPending}
              onClick={() => updateYear.mutate({ id: year.id, isCurrent: true })}
            >
              Marcar como actual
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link to={`${base}/ciclos/${year.id}/reglas`}>
              <Scale aria-hidden /> Reglas de cálculo
            </Link>
          </Button>
        </div>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-border rounded-md border border-border">
        {periods.map((period) => (
          <li
            key={period.id}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {period.number}. {period.name}{' '}
                <Badge tone={period.status === 'OPEN' ? 'success' : 'neutral'}>
                  {PERIOD_STATUS_LABELS[period.status]}
                </Badge>
              </p>
              <p className="text-sm text-muted-foreground">
                {shortDate(period.startDate)} – {shortDate(period.endDate)}
                {period.deliveryDateText ? ` · Entrega: ${period.deliveryDateText}` : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Editar ${period.name}`}
              onClick={() => setPeriodDialog(period)}
            >
              <Pencil aria-hidden />
            </Button>
          </li>
        ))}
        {periods.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">Sin periodos todavía.</li>
        ) : null}
      </ul>
      {nextNumber ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPeriodDialog('new')}>
          <CalendarPlus aria-hidden /> Agregar periodo {nextNumber}
        </Button>
      ) : null}

      <Dialog open={periodDialog !== null} onOpenChange={(open) => !open && setPeriodDialog(null)}>
        {periodDialog ? (
          <PeriodDialog
            year={year}
            period={periodDialog === 'new' ? undefined : periodDialog}
            number={periodDialog === 'new' ? (nextNumber ?? 1) : periodDialog.number}
            onDone={() => setPeriodDialog(null)}
          />
        ) : null}
      </Dialog>
    </Card>
  );
}

function CreateYearDialog({ onDone }: { onDone: () => void }) {
  const create = useCreateSchoolYear();
  const thisYear = new Date().getFullYear();
  const form = useForm({
    resolver: zodResolver(createSchoolYearSchema),
    defaultValues: {
      name: `${thisYear}-${thisYear + 1}`,
      startDate: `${thisYear}-08-31`,
      endDate: `${thisYear + 1}-07-16`,
      isCurrent: true,
    },
  });
  const { errors } = form.formState;
  return (
    <DialogContent
      title="Nuevo ciclo escolar"
      description="Se crea con las reglas de cálculo del Excel del 5°B."
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((values) => create.mutate(values, { onSuccess: onDone }))}
      >
        <FormField id="name" label="Nombre" error={errors.name?.message}>
          <Input
            {...fieldProps('name', errors.name?.message)}
            inputMode="numeric"
            {...form.register('name')}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="startDate" label="Inicio" error={errors.startDate?.message}>
            <Input
              type="date"
              {...fieldProps('startDate', errors.startDate?.message)}
              {...form.register('startDate')}
            />
          </FormField>
          <FormField id="endDate" label="Fin" error={errors.endDate?.message}>
            <Input
              type="date"
              {...fieldProps('endDate', errors.endDate?.message)}
              {...form.register('endDate')}
            />
          </FormField>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            {...form.register('isCurrent')}
          />
          Es el ciclo actual
        </label>
        <Button type="submit" size="lg" disabled={create.isPending}>
          {create.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Crear ciclo
        </Button>
      </form>
    </DialogContent>
  );
}

const periodFormSchema = createPeriodSchema;
type PeriodFormValues = z.input<typeof periodFormSchema>;

function PeriodDialog({
  year,
  period,
  number,
  onDone,
}: {
  year: SchoolYearView;
  period?: PeriodView;
  number: number;
  onDone: () => void;
}) {
  const create = useCreatePeriod();
  const update = useUpdatePeriod();
  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: {
      schoolYearId: year.id,
      number,
      name: period?.name ?? `Periodo ${['', 'I', 'II', 'III'][number]}`,
      startDate: period?.startDate ?? '',
      endDate: period?.endDate ?? '',
      deliveryDate: period?.deliveryDate,
      deliveryDateText: period?.deliveryDateText ?? '',
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((values) => {
    const deliveryDate = values.deliveryDate || undefined;
    if (period) {
      update.mutate(
        {
          id: period.id,
          name: values.name,
          startDate: values.startDate,
          endDate: values.endDate,
          deliveryDate: deliveryDate ?? null,
          deliveryDateText: values.deliveryDateText || null,
        },
        { onSuccess: onDone },
      );
    } else {
      create.mutate({ ...values, number, deliveryDate } as z.output<typeof periodFormSchema>, {
        onSuccess: onDone,
      });
    }
  });

  return (
    <DialogContent
      title={period ? `Editar ${period.name}` : `Nuevo periodo ${number}`}
      description={`Ciclo ${year.name}`}
    >
      <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
        <FormField id="name" label="Nombre" error={errors.name?.message}>
          <Input {...fieldProps('name', errors.name?.message)} {...form.register('name')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="startDate" label="Inicio" error={errors.startDate?.message}>
            <Input
              type="date"
              {...fieldProps('startDate', errors.startDate?.message)}
              {...form.register('startDate')}
            />
          </FormField>
          <FormField id="endDate" label="Fin" error={errors.endDate?.message}>
            <Input
              type="date"
              {...fieldProps('endDate', errors.endDate?.message)}
              {...form.register('endDate')}
            />
          </FormField>
        </div>
        <FormField
          id="deliveryDate"
          label="Fecha de entrega de boletas (opcional)"
          error={errors.deliveryDate?.message}
        >
          <Input
            type="date"
            {...fieldProps('deliveryDate', errors.deliveryDate?.message)}
            {...form.register('deliveryDate')}
          />
        </FormField>
        <FormField
          id="deliveryDateText"
          label="Texto de la fecha en la boleta (opcional)"
          hint="Ej. miércoles 18 de noviembre de 2026"
          error={errors.deliveryDateText?.message}
        >
          <Input
            {...fieldProps('deliveryDateText', errors.deliveryDateText?.message)}
            {...form.register('deliveryDateText')}
          />
        </FormField>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          Guardar periodo
        </Button>
      </form>
    </DialogContent>
  );
}
