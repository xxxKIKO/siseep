import { formatPhone, normalizePhone } from '@siseep/shared';
import { Copy, MessageCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface CredentialsCardProps {
  name: string;
  username: string;
  /** null: the person already had an account (no new password to deliver). */
  temporaryPassword: string | null;
  /** To prefill WhatsApp (guardians). The phone is the one already stored in the account. */
  phone?: string | null;
}

const loginUrl = () => `${window.location.origin}/iniciar-sesion`;

function message({ name, username, temporaryPassword }: CredentialsCardProps): string {
  return [
    `Hola, ${name}. Tu acceso al sistema de evaluación de la escuela:`,
    loginUrl(),
    `Usuario: ${username}`,
    temporaryPassword ? `Contraseña temporal: ${temporaryPassword}` : '',
    temporaryPassword ? 'Al entrar, el sistema te pedirá elegir tu propia contraseña.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Username + temporary password to hand over: copy, WhatsApp or print (shown only once). */
export function CredentialsCard(props: CredentialsCardProps) {
  const { username, temporaryPassword, phone } = props;
  const digits = phone ? normalizePhone(phone) : '';
  const whatsapp = `https://wa.me/${digits.length === 10 ? `52${digits}` : ''}?text=${encodeURIComponent(message(props))}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="print-area rounded-lg border-2 border-primary p-4">
        <p className="text-sm text-muted-foreground">{props.name}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-sm text-muted-foreground">Usuario</dt>
          <dd className="font-mono text-xl font-bold tracking-wide text-primary">{username}</dd>
          {temporaryPassword ? (
            <>
              <dt className="text-sm text-muted-foreground">Contraseña</dt>
              <dd className="font-mono text-xl font-bold tracking-wide text-primary">
                {temporaryPassword}
              </dd>
            </>
          ) : null}
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Entra en {loginUrl()}
          {temporaryPassword ? '. Es temporal: al entrar elegirá su propia contraseña.' : '.'}
        </p>
      </div>
      {temporaryPassword ? (
        <p className="text-xs text-muted-foreground">
          La contraseña no se vuelve a mostrar. Si se pierde, genera una nueva.
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button asChild>
          <a href={whatsapp} target="_blank" rel="noreferrer">
            <MessageCircle aria-hidden /> WhatsApp{digits ? ` ${formatPhone(digits)}` : ''}
          </a>
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(message(props))
              .then(() => toast.success('Copiado.'))
          }
        >
          <Copy aria-hidden /> Copiar
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden /> Imprimir
        </Button>
      </div>
    </div>
  );
}
