import * as Sentry from '@sentry/nestjs';
import { scrubText } from './common/scrub';

/**
 * Sentry, only when SENTRY_DSN is set. No personal data. Sentry 11 replaced `sendDefaultPii` with
 * `dataCollection`: everything that could carry personal data is off (the old
 * `sendDefaultPii: false`), and beforeSend still strips bodies, cookies and headers.
 * Imported first in main.ts so Sentry can instrument the rest.
 */
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
    },
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.query_string;
        event.request.headers = {};
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
      if (event.message) event.message = scrubText(event.message);
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = scrubText(exception.value);
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Breadcrumbs of HTTP calls keep only the method and the path (no query strings).
      if (breadcrumb.data?.url) breadcrumb.data.url = String(breadcrumb.data.url).split('?')[0];
      return breadcrumb;
    },
  });
}

export const sentryEnabled = Boolean(dsn);
