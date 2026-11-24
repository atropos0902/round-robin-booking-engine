import type { Db } from '../db';
import { logger } from '../observability/logger';

const LEASE_SECONDS = 60;

/** Another copy of the same message is being handled right now. Come back later. */
export class StillRunning extends Error {}

/**
 * Runs `work` once per consumer and event. A repeat is dropped, a failure is released so the next
 * delivery tries again. If the process dies between the work and the note that it is done, the
 * work runs twice: that gap cannot be closed from here, so the work itself should tolerate it.
 */
export async function handleOnce(db: Db, consumer: string, eventId: string, work: () => Promise<void>): Promise<'done' | 'duplicate'> {
  const claimed = await db.$queryRaw<unknown[]>`
    INSERT INTO inbox_entry (consumer, event_id, done, lease_until)
    VALUES (${consumer}, ${eventId}::uuid, false, now() + make_interval(secs => ${LEASE_SECONDS}))
    ON CONFLICT (consumer, event_id) DO UPDATE SET lease_until = excluded.lease_until
      WHERE NOT inbox_entry.done AND inbox_entry.lease_until < now()
    RETURNING 1`;

  const key = { consumer_eventId: { consumer, eventId } };
  if (claimed.length === 0) {
    const entry = await db.inboxEntry.findUnique({ where: key });
    if (!entry?.done) throw new StillRunning(`${consumer} is already working on ${eventId}`);
    logger.info({ consumer, eventId }, 'repeat dropped');
    return 'duplicate';
  }

  try {
    await work();
  } catch (error) {
    await db.$executeRaw`
      UPDATE inbox_entry SET lease_until = now() - interval '1 second'
       WHERE consumer = ${consumer} AND event_id = ${eventId}::uuid`;
    throw error;
  }
  await db.inboxEntry.update({ where: key, data: { done: true } });
  return 'done';
}
