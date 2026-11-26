import { type Role, ROLE_LABELS } from '@siseep/shared';
import { Hourglass } from 'lucide-react';
import { useAuth } from '@/auth/auth-context';
import { Card, CardContent } from '@/components/ui/card';

/** Empty home of each portal until its stage is built. */
export function ComingSoonPage({ role }: { role: Role }) {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{ROLE_LABELS[role]}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user ? `, ${user.firstName}` : ''}
        </h1>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft">
            <Hourglass className="size-7 text-primary" aria-hidden />
          </span>
          <p className="text-xl font-semibold">Próximamente</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Estamos preparando esta sección. Muy pronto podrás trabajar desde aquí.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
