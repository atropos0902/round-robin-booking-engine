import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { flushLogs, onContext, release, runWithContext, scrub } from '@rr/core';
import { waitUntil } from '@vercel/functions';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

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

export function configure(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id')?.slice(0, 64) ?? randomUUID();
    res.setHeader('x-request-id', requestId);
    // On Vercel this keeps the function alive until the lines are out. Elsewhere it does nothing.
    res.on('finish', () => waitUntil(flushLogs()));
    Sentry.withIsolationScope(() => runWithContext({ requestId }, next));
  });
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configure(app);
  return app;
}
