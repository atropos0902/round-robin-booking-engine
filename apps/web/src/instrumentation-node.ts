import * as Sentry from '@sentry/nextjs';
import { onContext, release, scrub } from '@rr/core';

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  release,
  environment: process.env.APP_ENV ?? 'local',
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: (event) => scrub(event),
  beforeSendTransaction: (event) => scrub(event),
});

onContext(({ bookingId }) => {
  if (bookingId) Sentry.getIsolationScope().setTag('booking_id', bookingId);
});
