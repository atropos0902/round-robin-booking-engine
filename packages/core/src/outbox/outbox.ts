import type { OutboxEvent } from '@prisma/client';
import { type DomainEvent, domainEvent } from '../contracts';
import type { Db, Tx } from '../db';
import { logger } from '../observability/logger';

/** Must be called with the transaction that made the change, that is the whole point of it. */
export async function writeEvent(tx: Tx, event: DomainEvent): Promise<void> {
  const { id, type, version, aggregateId, occurredAt, payload } = domainEvent.parse(event);
  await tx.outboxEvent.create({ data: { id, type, version, aggregateId, occurredAt: new Date(occurredAt), payload } });
}

export interface EventPublisher {
  /** Returns the ids that were not accepted. Throwing means none were. */
  publish(events: readonly DomainEvent[]): Promise<string[]>;
}

const BATCH = 10;
const LEASE_SECONDS = 30;

export class OutboxRelay {
  constructor(
    private readonly db: Db,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Publishes one batch and returns how many were claimed.
   *
   * Rows are leased, not held under a lock, so no transaction stays open during the network call.
   * A relay that dies after publishing leaves rows that are sent again when the lease runs out.
   */
  async drainOnce(): Promise<number> {
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      UPDATE outbox_event
         SET claimed_until = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM outbox_event
          WHERE published_at IS NULL AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY seq LIMIT ${BATCH}
            FOR UPDATE SKIP LOCKED)
      RETURNING id`;
    if (rows.length === 0) return 0;

    const ids = rows.map((r) => r.id);
    const events = (await this.db.outboxEvent.findMany({ where: { id: { in: ids } }, orderBy: { seq: 'asc' } })).map(toEvent);
    let failed: Set<string>;
    try {
      failed = new Set(await this.publisher.publish(events));
    } catch (error) {
      logger.error({ err: error }, 'event bus refused the batch');
      failed = new Set(ids);
    }

    const sent = ids.filter((id) => !failed.has(id));
    if (sent.length > 0) {
      await this.db.outboxEvent.updateMany({ where: { id: { in: sent } }, data: { publishedAt: new Date() } });
    }
    if (failed.size > 0) {
      await this.db.$executeRaw`
        UPDATE outbox_event
           SET claimed_until = now() + make_interval(secs => least(power(2, least(attempts, 9)), 300))
         WHERE id = ANY(${[...failed]}::uuid[])`;
      logger.warn({ failed: failed.size, sent: sent.length }, 'some events stay in the outbox');
    }
    return rows.length;
  }

  async drain(deadline: number): Promise<number> {
    let total = 0;
    while (Date.now() < deadline) {
      const n = await this.drainOnce();
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }
}

export async function outboxStatus(db: Db): Promise<{ pending: number; oldestSeconds: number; retried: number }> {
  const [row] = await db.$queryRaw<{ pending: number; oldest: number | null; retried: number }[]>`
    SELECT count(*)::int AS pending,
           extract(epoch FROM now() - min(occurred_at))::float8 AS oldest,
           (count(*) FILTER (WHERE attempts > 1))::int AS retried
      FROM outbox_event WHERE published_at IS NULL`;
  return { pending: row!.pending, oldestSeconds: Math.max(0, Math.round(row!.oldest ?? 0)), retried: row!.retried };
}

function toEvent(row: OutboxEvent): DomainEvent {
  return domainEvent.parse({ ...row, occurredAt: row.occurredAt.toISOString() });
}
