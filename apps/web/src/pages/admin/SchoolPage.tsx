import { zodResolver } from '@hookform/resolvers/zod';
import { LOGO_MAX_BYTES, PRIVACY_PENDING_REVIEW, updateSchoolSchema } from '@siseep/shared';
import { ImageUp, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { usePortalBase } from '@/auth/ability';
import { useSchool, useSchoolLogo, useUpdateSchool, useUploadLogo } from '@/api/catalog';
import { usePrivacyNotice, useUpdatePrivacyNotice } from '@/api/guardian';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fieldProps } from '@/lib/form';

export function SchoolPage() {
  const base = usePortalBase();
  const school = useSchool();
  const logo = useSchoolLogo(Boolean(school.data?.hasLogo));
  const update = useUpdateSchool();
  const upload = useUploadLogo();
  const fileInput = useRef<HTMLInputElement>(null);
  const form = useForm({
    resolver: zodResolver(updateSchoolSchema),
    defaultValues: { name: '', shortName: '', cct: '', city: '', state: '' },
  });
  const { errors } = form.formState;

  useEffect(() => {
    if (school.data) {
      form.reset({
        name: school.data.name,
        shortName: school.data.shortName ?? '',
        cct: school.data.cct ?? '',
        city: school.data.city ?? '',
        state: school.data.state ?? '',
      });
    }
  }, [school.data, form]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('El logo debe ser una imagen PNG o JPG.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('El logo debe pesar máximo 1 MB.');
      return;
    }
    upload.mutate(file);
  };

  return (
    <div>
      <PageHeader
        title="Escuela"
        description="Estos datos aparecen en las boletas."
        back={{ to: base, label: base === '/director' ? 'Tablero' : 'Administración' }}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Datos generales</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit((values) => update.mutate(values))}
            >
              <FormField id="name" label="Nombre oficial" error={errors.name?.message}>
                <Input {...fieldProps('name', errors.name?.message)} {...form.register('name')} />
              </FormField>
              <FormField id="shortName" label="Nombre corto" error={errors.shortName?.message}>
                <Input
                  {...fieldProps('shortName', errors.shortName?.message)}
                  {...form.register('shortName')}
                />
              </FormField>
              <FormField
                id="cct"
                label="Clave de centro de trabajo (CCT)"
                error={errors.cct?.message}
              >
                <Input
                  {...fieldProps('cct', errors.cct?.message)}
                  autoCapitalize="characters"
                  placeholder="06DPR0000X"
                  {...form.register('cct')}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="city" label="Ciudad" error={errors.city?.message}>
                  <Input {...fieldProps('city', errors.city?.message)} {...form.register('city')} />
                </FormField>
                <FormField id="state" label="Estado" error={errors.state?.message}>
                  <Input
                    {...fieldProps('state', errors.state?.message)}
                    {...form.register('state')}
                  />
                </FormField>
              </div>
              <Button
                type="submit"
                className="self-start"
                disabled={update.isPending || school.isLoading}
              >
                {update.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Guardar
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div className="flex size-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40">
              {logo.data ? (
                <img
                  src={logo.data}
                  alt="Logo de la escuela"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="px-4 text-center text-sm text-muted-foreground">Sin logo</span>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label="Elegir logo"
              onChange={(event) => {
                onFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
            >
              {upload.isPending ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <ImageUp aria-hidden />
              )}
              {school.data?.hasLogo ? 'Cambiar logo' : 'Subir logo'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">PNG o JPG, máximo 1 MB.</p>
          </CardContent>
        </Card>

        <PrivacyNoticeCard />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cierre de periodo</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-primary"
                checked={school.data?.teacherCanClosePeriod ?? false}
                disabled={update.isPending || school.isLoading}
                onChange={(event) => update.mutate({ teacherCanClosePeriod: event.target.checked })}
              />
              <span>
                <span className="font-medium">
                  El maestro titular puede cerrar el periodo de su grupo
                </span>
                <span className="block text-muted-foreground">
                  Si no se activa, el maestro solo envía a revisión y la administración cierra.
                  Publicar y reabrir siguen siendo de la administración.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Privacy notice shown in /privacidad and accepted by guardians (each save is a new version). */
function PrivacyNoticeCard() {
  const notice = usePrivacyNotice();
  const save = useUpdatePrivacyNotice();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? notice.data?.text ?? '';
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Aviso de privacidad</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice.data?.pendingReview ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Es la plantilla, marcada "{PRIVACY_PENDING_REVIEW}". Revísala con la dirección, ajústala
            y guárdala.
          </p>
        ) : notice.data ? (
          <p className="text-sm text-muted-foreground">
            Versión {notice.data.version}. Al guardar cambios sube la versión y los padres la
            aceptan de nuevo la próxima vez que vinculen a un hijo.
          </p>
        ) : null}
        <Label htmlFor="privacy-text">Texto del aviso</Label>
        <Textarea
          id="privacy-text"
          rows={14}
          value={value}
          onChange={(e) => setText(e.target.value)}
          disabled={notice.isLoading}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() =>
              save.mutate(value.replace(`${PRIVACY_PENDING_REVIEW}\n\n`, ''), {
                onSuccess: () => setText(null),
              })
            }
            disabled={save.isPending || value.trim().length < 50}
          >
            {save.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            Guardar aviso
          </Button>
          <Button variant="outline" asChild>
            <a href="/privacidad" target="_blank" rel="noreferrer">
              Ver página pública
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
