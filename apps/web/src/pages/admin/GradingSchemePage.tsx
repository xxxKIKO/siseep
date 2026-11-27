import { FIELD_COLORS, type GradingScheme, gradingSchemeSchema } from '@siseep/shared';
import { LoaderCircle, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useCan, usePortalBase } from '@/auth/ability';
import { useGradingScheme, useSaveGradingScheme, useSchoolYears } from '@/api/catalog';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Weights are edited as percentages (50, 20, 30) and stored as fractions (0.5, 0.2, 0.3). */
const toPct = (value: number) => Math.round(value * 1000) / 10;
const toFraction = (value: number) => Math.round(value * 10) / 1000;

function PercentInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          max={100}
          step={0.1}
          value={Number.isNaN(value) ? '' : toPct(value)}
          onChange={(event) => onChange(toFraction(Number(event.target.value)))}
          className="pr-8"
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

export function GradingSchemePage() {
  const { yearId = '' } = useParams();
  const years = useSchoolYears();
  const scheme = useGradingScheme(yearId);
  const year = years.data?.find((y) => y.id === yearId);

  if (!scheme.data) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  // Remounts with fresh data after saving (the draft starts from the saved rules).
  return (
    <SchemeEditor
      key={scheme.dataUpdatedAt}
      yearId={yearId}
      yearName={year?.name ?? ''}
      saved={scheme.data}
    />
  );
}

function SchemeEditor({
  yearId,
  yearName,
  saved,
}: {
  yearId: string;
  yearName: string;
  saved: GradingScheme;
}) {
  const base = usePortalBase();
  const canEdit = useCan().can('update', 'GradingScheme', {});
  const save = useSaveGradingScheme(yearId);
  const [draft, setDraft] = useState<GradingScheme>(() => structuredClone(saved));

  const validation = gradingSchemeSchema.safeParse(draft);
  const problems = validation.success
    ? []
    : [...new Set(validation.error.issues.map((i) => i.message))];
  const edit = (change: (next: GradingScheme) => void) => {
    const next = structuredClone(draft);
    change(next);
    setDraft(next);
  };

  return (
    <div>
      <PageHeader
        title="Reglas de cálculo"
        description={`Ciclo ${yearName}. Calificación del campo = desempeño + proyectos + exámenes, mezclada con la materia complementaria cuando aplica.`}
        back={{ to: `${base}/ciclos`, label: 'Ciclos y periodos' }}
      />
      <div className="flex flex-col gap-4">
        {draft.fields.map((field, index) => {
          const sum = field.weights.DESEMPENO + field.weights.PROYECTO + field.weights.EXAMEN;
          return (
            <Card key={field.key} className="overflow-hidden">
              <div
                className="h-1.5"
                style={{ backgroundColor: FIELD_COLORS[field.key] }}
                aria-hidden
              />
              <div className="flex flex-col gap-4 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{field.name}</h2>
                  <span
                    className={`text-sm font-medium ${Math.abs(sum - 1) < 1e-9 ? 'text-muted-foreground' : 'text-destructive'}`}
                  >
                    Suma: {toPct(sum)}%
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {(['DESEMPENO', 'PROYECTO', 'EXAMEN'] as const).map((component) => (
                    <PercentInput
                      key={component}
                      id={`${field.key}-${component}`}
                      label={
                        { DESEMPENO: 'Desempeño', PROYECTO: 'Proyectos', EXAMEN: 'Exámenes' }[
                          component
                        ]
                      }
                      value={field.weights[component]}
                      onChange={(value) =>
                        edit((next) => (next.fields[index]!.weights[component] = value))
                      }
                    />
                  ))}
                </div>
                {field.complementary ? (
                  <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/50 p-3">
                    <PercentInput
                      id={`${field.key}-field-weight`}
                      label="Peso del campo"
                      value={field.complementary.fieldWeight}
                      onChange={(value) =>
                        edit((next) => (next.fields[index]!.complementary!.fieldWeight = value))
                      }
                    />
                    <PercentInput
                      id={`${field.key}-subject-weight`}
                      label={field.complementary.name}
                      value={field.complementary.subjectWeight}
                      onChange={(value) =>
                        edit((next) => (next.fields[index]!.complementary!.subjectWeight = value))
                      }
                    />
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}

        <Card className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lowThreshold">Marcar "Ojo en" debajo de</Label>
            <Input
              id="lowThreshold"
              type="number"
              inputMode="decimal"
              step={0.1}
              value={draft.lowThreshold}
              onChange={(e) => edit((next) => (next.lowThreshold = Number(e.target.value)))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lowLegend">Texto de la leyenda</Label>
            <Input
              id="lowLegend"
              value={draft.lowLegend}
              onChange={(e) => edit((next) => (next.lowLegend = e.target.value))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="minFinal">Ajuste mínimo</Label>
              <Input
                id="minFinal"
                type="number"
                inputMode="numeric"
                value={draft.minFinal}
                onChange={(e) => edit((next) => (next.minFinal = Number(e.target.value)))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxFinal">Ajuste máximo</Label>
              <Input
                id="maxFinal"
                type="number"
                inputMode="numeric"
                value={draft.maxFinal}
                onChange={(e) => edit((next) => (next.maxFinal = Number(e.target.value)))}
              />
            </div>
          </div>
        </Card>

        {problems.length ? (
          <Alert>
            <ul className="list-inside list-disc">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => validation.success && save.mutate(validation.data)}
              disabled={!validation.success || save.isPending}
            >
              {save.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Guardar reglas
            </Button>
            <Button variant="ghost" onClick={() => setDraft(structuredClone(saved))}>
              <RotateCcw aria-hidden /> Descartar cambios
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Solo lectura: las reglas de cálculo las cambia la administración.
          </p>
        )}
      </div>
    </div>
  );
}
