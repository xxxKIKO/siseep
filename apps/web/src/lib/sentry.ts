const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/**
 * Error monitoring, only when VITE_SENTRY_DSN is set at build time. No personal data: Sentry 11
 * replaced `sendDefaultPii` with `dataCollection` (all off), no session replay, and URLs lose their
 * query string (it can carry codes such as /registro?codigo=…).
 */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  // Loaded only when configured, so it never weighs on the first load.
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request.url = event.request.url?.split('?')[0];
        delete event.request.query_string;
        delete event.request.cookies;
        event.request.headers = {};
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = exception.value.replace(EMAIL, '[correo]');
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // No typed text and no form values; URLs without query strings.
      if (breadcrumb.category === 'ui.input') return null;
      if (breadcrumb.data?.url) breadcrumb.data.url = String(breadcrumb.data.url).split('?')[0];
      if (breadcrumb.data?.to) breadcrumb.data.to = String(breadcrumb.data.to).split('?')[0];
      if (breadcrumb.data?.from) breadcrumb.data.from = String(breadcrumb.data.from).split('?')[0];
      return breadcrumb;
    },
  });
}
