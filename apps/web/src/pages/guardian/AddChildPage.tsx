import { formatGuardianCode, type GuardianCodePreview, guardianCodeSchema } from '@siseep/shared';
import { useMutation } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { previewGuardianCode } from '@/api/guardian';
import { PageHeader } from '@/components/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ApiError, errorMessage } from '@/lib/api-client';
import { RedeemForm } from '@/pages/public/GuardianSignUpPage';

/** /padres/agregar — a signed-in guardian redeems another code (a brother or sister). */
export function AddChildPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<{ code: string; data: GuardianCodePreview } | null>(null);
  const check = useMutation({
    mutationFn: async (value: string) => {
      const parsed = guardianCodeSchema.safeParse(value);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Código no válido');
      return { code: parsed.data, data: await previewGuardianCode(parsed.data) };
    },
    onSuccess: setPreview,
  });

  return (
    <div>
      <PageHeader
        title="Agregar hijo(a)"
        description="Escribe el código que te dio la maestra de tu otro hijo(a)."
        back={{ to: '/padres', label: 'Mis hijos' }}
      />
      <Card className="max-w-md">
        <CardContent className="pt-5">
          {preview ? (
            <>
              <div className="mb-4 rounded-lg border border-primary/20 bg-primary-soft p-4 text-sm">
                <p className="text-muted-foreground">Vas a vincularte con:</p>
                <p className="mt-1 text-lg font-semibold text-primary">
                  {preview.data.studentName}, {preview.data.groupName}
                </p>
                <button
                  type="button"
                  className="mt-2 min-h-11 text-sm font-medium text-primary underline"
                  onClick={() => setPreview(null)}
                >
                  No es mi hijo(a): usar otro código
                </button>
              </div>
              <RedeemForm
                code={preview.code}
                onDone={() => {
                  toast.success('Listo, ya puedes ver a tu hijo(a).');
                  navigate('/padres', { replace: true });
                }}
              />
            </>
          ) : (
            <form
              noValidate
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                check.mutate(code);
              }}
            >
              {check.isError ? (
                <Alert>
                  {check.error instanceof ApiError
                    ? errorMessage(check.error)
                    : (check.error as Error).message}
                </Alert>
              ) : null}
              <FormField id="code" label="Código">
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onBlur={() => code && setCode(formatGuardianCode(code))}
                  autoCapitalize="characters"
                  placeholder="ABCD-2345"
                  className="text-center font-mono text-xl tracking-widest"
                  maxLength={12}
                />
              </FormField>
              <Button type="submit" size="lg" disabled={check.isPending || !code.trim()}>
                {check.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
                Continuar
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
