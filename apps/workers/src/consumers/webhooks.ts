import { createHmac } from 'node:crypto';
import { type Db, type DomainEvent, handleOnce, logger } from '@rr/core';
import type { Consumer } from './consumer';

export function sign(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/** Keeps a record per subscriber, so one broken endpoint does not repeat calls to the others. */
export class WebhookConsumer implements Consumer {
  readonly name = 'webhooks';
  readonly ownInbox = true;

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async handle(event: DomainEvent, db: Db): Promise<void> {
    const subscriptions = await db.webhookSubscription.findMany({ where: { active: true } });
    const results = await Promise.allSettled(
      subscriptions.map((s) => handleOnce(db, `webhooks:${s.id}`, event.id, () => this.deliver(s, event))),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn({ failed: failed.length, total: results.length }, 'webhooks will be tried again');
      throw new AggregateError(failed.map((f) => f.reason), `${failed.length} of ${results.length} webhooks failed`);
    }
  }

  private async deliver(subscription: { url: string; secret: string }, event: DomainEvent): Promise<void> {
    const body = JSON.stringify(event);
    const response = await this.fetcher(subscription.url, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        'content-type': 'application/json',
        'x-event-id': event.id,
        'x-signature': sign(subscription.secret, Math.floor(this.now() / 1000), body),
      },
    });
    if (!response.ok) throw new Error(`webhook answered ${response.status}`);
  }
}
