import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">No encontramos esta página</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Revisa la dirección o vuelve al inicio.
      </p>
      <Button asChild>
        <Link to="/">Ir al inicio</Link>
      </Button>
    </div>
  );
}
