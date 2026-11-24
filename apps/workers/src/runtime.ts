import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import * as Sentry from '@sentry/aws-serverless';
import { onContext, release, scrub } from '@rr/core';

function startSentry(): void {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || undefined,
    release,
    environment: process.env.APP_ENV ?? 'local',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrub(event),
    beforeSendTransaction: (event) => scrub(event),
  });
}

onContext(({ bookingId }) => {
  if (bookingId) Sentry.getIsolationScope().setTag('booking_id', bookingId);
});

async function load(): Promise<void> {
  const id = process.env.APP_SECRET_ID;
  if (id) {
    const secret = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: id }));
    Object.assign(process.env, JSON.parse(secret.SecretString ?? '{}'));
  }
  startSentry();
}

let loading: Promise<void> | undefined;

/**
 * Reads the app secret once per cold start. Prisma, Sentry and the log sink all take their
 * settings from it, so nothing may touch them before this is done.
 */
export function ready(): Promise<void> {
  loading ??= load().catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}
