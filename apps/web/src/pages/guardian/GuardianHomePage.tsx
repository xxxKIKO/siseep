import { RELATIONSHIP_LABELS } from '@siseep/shared';
import { ChevronRight, LoaderCircle } from 'lucide-react';
import { Link, Navigate } from 'react-router';
import { useChildren } from '@/api/guardian';
import { useAuth } from '@/auth/auth-context';
import { Card } from '@/components/ui/card';

/** /padres — one card per child; with a single child it opens it directly. */
export function GuardianHomePage() {
  const { user } = useAuth();
  const children = useChildren();

  if (children.isLoading) {
    return (
      <LoaderCircle
        className="mx-auto mt-10 size-6 animate-spin text-primary"
        aria-label="Cargando"
      />
    );
  }
  const list = children.data ?? [];
  if (list.length === 1) return <Navigate to={`/padres/hijos/${list[0]!.id}`} replace />;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{user ? `, ${user.firstName}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {list.length ? 'Elige a tu hijo(a) para ver cómo va.' : 'Aún no tienes hijos vinculados.'}
        </p>
      </div>
      {list.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((child) => (
            <li key={child.id}>
              <Link to={`/padres/hijos/${child.id}`} className="block rounded-lg">
                <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/40">
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-lg font-semibold text-primary"
                    aria-hidden
                  >
                    {child.firstName.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold">{child.shortName}</span>
                    <span className="block text-sm text-muted-foreground">
                      Grupo {child.group.name}
                      {child.teacher ? ` · ${child.teacher}` : ''}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {RELATIONSHIP_LABELS[child.relationship]}
                    </span>
                  </span>
                  <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-muted-foreground">
        ¿Te falta un hijo o hija? Pide a su maestra que lo agregue con tu mismo teléfono.
      </p>
    </div>
  );
}
