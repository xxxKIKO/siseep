import {
  formatGuardianCode,
  type GroupGuardianRow,
  type GuardianInvitationView,
  RELATIONSHIP_LABELS,
} from '@siseep/shared';
import { Copy, KeyRound, LoaderCircle, MessageCircle, Printer } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { toast } from 'sonner';
import { useGroup } from '@/api/catalog';
import { printGuardianCodes, useCreateGuardianCode, useGroupGuardians } from '@/api/guardian';
import { usePortalBase } from '@/auth/ability';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/dates';

const STATUS = {
  LINKED: { label: 'Vinculado', tone: 'success' },
  PENDING: { label: 'Código pendiente', tone: 'warning' },
  NONE: { label: 'Sin código', tone: 'neutral' },
} as const;

/** Prefilled WhatsApp message (no phone number is stored: the teacher picks the contact). */
function whatsappLink(invitation: GuardianInvitationView): string {
  const text = [
    `Hola. Para ver las calificaciones de ${invitation.student.shortName} (${invitation.groupName}) entra a:`,
    invitation.url,
    `Código: ${formatGuardianCode(invitation.code)}`,
    `Vence el ${formatDate(invitation.expiresAt, "d 'de' MMMM")} y sirve una sola vez.`,
  ].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** /maestro/grupos/:groupId/padres — guardian codes per student. */
export function GuardiansPage() {
  const { groupId = '' } = useParams();
  const base = usePortalBase();
  const group = useGroup(groupId);
  const rows = useGroupGuardians(groupId);
  const create = useCreateGuardianCode(groupId);
  const [generated, setGenerated] = useState<GuardianInvitationView | null>(null);
  const [printing, setPrinting] = useState(false);

  if (group.isLoading || rows.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  if (!group.data || !rows.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Los códigos para padres los genera el maestro titular del grupo.
      </p>
    );
  }
  const list = rows.data;
  const linked = list.filter((r) => r.status === 'LINKED').length;
  const withoutGuardian = list.length - linked;

  const print = async () => {
    setPrinting(true);
    try {
      await printGuardianCodes(groupId, group.data!.name);
      await rows.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={`Padres de familia · ${group.data.name}`}
        description={`${linked} de ${list.length} alumnos con un familiar vinculado`}
        back={{ to: `${base}/grupos/${groupId}`, label: `Grupo ${group.data.name}` }}
        actions={
          withoutGuardian ? (
            <Button variant="outline" size="sm" onClick={() => void print()} disabled={printing}>
              {printing ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Printer aria-hidden />
              )}
              Imprimir códigos ({withoutGuardian})
            </Button>
          ) : null
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Cada código sirve una vez y vence en 14 días. "Imprimir códigos" genera códigos nuevos en
        tiras para recortar, para los alumnos que aún no tienen familiar vinculado.
      </p>
      <ul className="flex flex-col gap-2">
        {list.map((row) => (
          <li key={row.student.id}>
            <GuardianRow
              row={row}
              pending={create.isPending && create.variables === row.student.id}
              onGenerate={() =>
                create.mutate(row.student.id, {
                  onSuccess: (invitation) => setGenerated(invitation),
                })
              }
            />
          </li>
        ))}
      </ul>

      <Dialog open={generated !== null} onOpenChange={(open) => !open && setGenerated(null)}>
        {generated ? (
          <DialogContent
            title={`Código para ${generated.student.shortName}`}
            description="Compártelo con la familia. No se vuelve a mostrar: si se pierde, genera otro."
          >
            <p
              className="mb-2 rounded-lg border-2 border-primary py-4 text-center font-mono text-3xl font-bold tracking-widest text-primary"
              aria-label={`Código ${generated.code.split('').join(' ')}`}
            >
              {formatGuardianCode(generated.code)}
            </p>
            <p className="mb-4 text-center text-sm text-muted-foreground">
              Vence el {formatDate(generated.expiresAt, "d 'de' MMMM")}
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild size="lg">
                <a href={whatsappLink(generated)} target="_blank" rel="noreferrer">
                  <MessageCircle aria-hidden /> Compartir por WhatsApp
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`${generated.url}\nCódigo: ${formatGuardianCode(generated.code)}`)
                    .then(() => toast.success('Copiado.'));
                }}
              >
                <Copy aria-hidden /> Copiar enlace y código
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function GuardianRow({
  row,
  pending,
  onGenerate,
}: {
  row: GroupGuardianRow;
  pending: boolean;
  onGenerate: () => void;
}) {
  const status = STATUS[row.status];
  return (
    <Card className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          <span className="text-muted-foreground">{row.student.listNumber}.</span>{' '}
          {row.student.fullName}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge tone={status.tone}>{status.label}</Badge>
          {row.links.map((l) => (
            <span key={l.id}>
              {l.guardian.name} ({RELATIONSHIP_LABELS[l.relationship]})
            </span>
          ))}
          {row.pendingCodes ? (
            <span>
              {row.pendingCodes} {row.pendingCodes === 1 ? 'código sin usar' : 'códigos sin usar'}
            </span>
          ) : null}
        </div>
      </div>
      {row.links.length < 4 ? (
        <Button variant="outline" onClick={onGenerate} disabled={pending}>
          {pending ? (
            <LoaderCircle className="animate-spin" aria-hidden />
          ) : (
            <KeyRound aria-hidden />
          )}
          Generar código
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Máximo de 4 tutores</span>
      )}
    </Card>
  );
}
