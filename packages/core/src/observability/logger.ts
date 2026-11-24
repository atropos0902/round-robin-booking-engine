import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { ElasticSink } from './elastic-sink';

export interface LogContext {
  bookingId?: string;
  requestId?: string;
  eventId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();
const listeners: ((context: LogContext) => void)[] = [];

export function runWithContext<T>(context: LogContext, work: () => T): T {
  return storage.run({ ...context }, work);
}

/** Adds to the current request, so every later line carries it too. */
export function addContext(context: LogContext): void {
  const current = storage.getStore();
  if (current) Object.assign(current, context);
  for (const listener of listeners) listener(context);
}

/** Sentry hooks in here, which keeps it out of this package. */
export function onContext(listener: (context: LogContext) => void): void {
  listeners.push(listener);
}

export const release = process.env.APP_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';

let sink: ElasticSink | undefined;

// Looked up on every line and not once at import: on AWS the address arrives with the secret.
const elastic = {
  write(line: string): void {
    if (!process.env.ELASTIC_URL) return;
    sink ??= ElasticSink.connect(process.env.ELASTIC_URL, process.env.ELASTIC_API_KEY);
    sink.write(line);
  },
};

/** Field names follow ECS, so Elastic needs no mapping of its own. */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { 'service.name': process.env.SERVICE_NAME ?? 'rr', 'service.version': release },
    messageKey: 'message',
    timestamp: () => `,"@timestamp":"${new Date().toISOString()}"`,
    formatters: { level: (label) => ({ 'log.level': label }) },
    mixin: () => {
      const c = storage.getStore();
      return {
        ...(c?.bookingId ? { 'labels.booking_id': c.bookingId } : {}),
        ...(c?.eventId ? { 'labels.event_id': c.eventId } : {}),
        ...(c?.requestId ? { 'http.request.id': c.requestId } : {}),
      };
    },
    redact: ['email', '*.email', 'inviteeEmail', '*.inviteeEmail', 'authorization'],
  },
  pino.multistream([{ stream: process.stdout }, { stream: elastic }]),
);

/** Functions freeze when they return, so the buffer has to go out first. */
export async function flushLogs(): Promise<void> {
  await sink?.flush();
}
