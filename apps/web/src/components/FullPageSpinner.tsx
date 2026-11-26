import { LoaderCircle } from 'lucide-react';

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status">
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
