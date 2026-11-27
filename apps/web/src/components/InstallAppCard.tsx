import { CheckCircle2, Download, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Chrome/Edge/Android event (not in the TypeScript DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Instalar en tu celular": the browser prompt, or the steps for iPhone (Safari). */
export function InstallAppCard() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Instalar en tu celular</CardTitle>
        <CardDescription>
          Ábrela como una app desde la pantalla de inicio, sin buscar la página.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {installed ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" aria-hidden /> Ya está instalada en este dispositivo.
          </p>
        ) : prompt ? (
          <Button
            onClick={async () => {
              await prompt.prompt();
              const choice = await prompt.userChoice;
              if (choice.outcome === 'accepted') setInstalled(true);
              setPrompt(null);
            }}
          >
            <Download aria-hidden /> Instalar en tu celular
          </Button>
        ) : isIos() ? (
          <ol className="list-decimal pl-5 text-sm leading-relaxed">
            <li>
              Abre esta página en Safari y toca{' '}
              <Share className="inline size-4" aria-label="Compartir" /> (Compartir).
            </li>
            <li>Elige "Agregar a pantalla de inicio".</li>
            <li>Toca "Agregar". Listo: busca el ícono "Evaluación".</li>
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">
            Abre el menú del navegador (⋮) y elige "Instalar app" o "Agregar a la pantalla de
            inicio".
          </p>
        )}
      </CardContent>
    </Card>
  );
}
