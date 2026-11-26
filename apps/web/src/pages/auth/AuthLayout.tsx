import type { ReactNode } from 'react';
import { FieldColorStrip } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Centered card for the public screens (login, recovery, invitation). */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-primary text-primary-foreground">
        <FieldColorStrip />
        <div className="mx-auto max-w-md px-5 py-6 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-white/70">
            Sistema de evaluación escolar
          </p>
          <p className="mt-1 text-lg font-semibold leading-snug">
            Esc. Prim. Fed. Dr. Salvador Allende T.M.
          </p>
          <p className="text-sm text-white/80">Colima, Col.</p>
        </div>
      </header>

      <main className="flex flex-1 justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
          {footer ? <div className="mt-4 text-center text-sm">{footer}</div> : null}
        </div>
      </main>

      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground">
        Tus datos y los de los alumnos se usan solo para la evaluación escolar. Aviso de privacidad:
        pendiente de revisión por la dirección.
      </footer>
    </div>
  );
}
