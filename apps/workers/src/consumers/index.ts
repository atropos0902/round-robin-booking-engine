import { logger } from '@rr/core';
import { CalendarSync } from './calendar-sync';
import type { Consumer } from './consumer';
import { EmailConsumer, sesMailer } from './email';
import { WebhookConsumer } from './webhooks';

export const CONSUMERS = ['calendar-sync', 'email', 'webhooks'] as const;
export type ConsumerName = (typeof CONSUMERS)[number];

export function createConsumer(name: ConsumerName): Consumer {
  switch (name) {
    case 'calendar-sync':
      return new CalendarSync();
    case 'webhooks':
      return new WebhookConsumer();
    case 'email': {
      const from = process.env.MAIL_FROM;
      const send = from
        ? sesMailer(from)
        : async ({ subject }: { subject: string }) => logger.info({ subject }, 'mail is off, not sent');
      return new EmailConsumer(send, process.env.APP_URL ?? 'http://localhost:3000');
    }
  }
}
