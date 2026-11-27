import { PRIVACY_PENDING_REVIEW } from '@siseep/shared';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router';
import { usePrivacyNotice } from '@/api/guardian';
import { Alert } from '@/components/ui/alert';
import { formatDate } from '@/lib/dates';
import { AuthLayout } from '@/pages/auth/AuthLayout';

/** /privacidad — public privacy notice (section 7). The admin edits it in /admin/escuela. */
export function PrivacyPage() {
  const notice = usePrivacyNotice();
  return (
    <AuthLayout
      title="Aviso de privacidad"
      description={
        notice.data
          ? `Versión ${notice.data.version}${notice.data.updatedAt ? ` · actualizado el ${formatDate(notice.data.updatedAt, "d 'de' MMMM 'de' yyyy")}` : ''}`
          : undefined
      }
      footer={
        <Link to="/iniciar-sesion" className="text-muted-foreground underline">
          Ir a iniciar sesión
        </Link>
      }
    >
      {notice.isLoading ? (
        <LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-label="Cargando" />
      ) : notice.data ? (
        <div className="flex flex-col gap-3">
          {notice.data.pendingReview ? (
            <Alert variant="error" className="font-semibold">
              {PRIVACY_PENDING_REVIEW}
            </Alert>
          ) : null}
          <div className="whitespace-pre-line text-sm leading-relaxed">
            {notice.data.text.replace(`${PRIVACY_PENDING_REVIEW}\n\n`, '')}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No pudimos cargar el aviso de privacidad.</p>
      )}
    </AuthLayout>
  );
}
