import * as Sentry from '@sentry/nextjs';

/** The address of a booking page is the key to cancelling it. */
function hideToken<T extends { request?: { url?: string } }>(event: T): T {
  if (event.request?.url) event.request.url = event.request.url.replace(/\/bookings\/[^/?#]+/, '/bookings/[token]');
  return event;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  release: process.env.NEXT_PUBLIC_RELEASE,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: hideToken,
  beforeSendTransaction: hideToken,
  // Breadcrumbs repeat the addresses that were visited and fetched.
  beforeBreadcrumb: (crumb) => (crumb.category === 'navigation' || crumb.category === 'fetch' ? null : crumb),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
