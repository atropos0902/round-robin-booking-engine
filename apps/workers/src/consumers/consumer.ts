import type { SQSBatchResponse, SQSRecord } from 'aws-lambda';
import * as Sentry from '@sentry/aws-serverless';
import { type Db, type DomainEvent, addContext, domainEvent, flushLogs, handleOnce, logger, runWithContext } from '@rr/core';
import { z } from 'zod';

export interface Consumer {
  readonly name: string;
  handle(event: DomainEvent, db: Db): Promise<void>;
  /** Set when the consumer keeps its own record per target and must see every delivery. */
  readonly ownInbox?: boolean;
}

const envelope = z.object({ detail: domainEvent });

async function handleRecord(consumer: Consumer, db: Db, record: SQSRecord): Promise<void> {
  const event = envelope.parse(JSON.parse(record.body)).detail;
  addContext({ eventId: event.id, bookingId: event.payload.bookingId });
  if (event.payload.synthetic) {
    logger.info({ consumer: consumer.name }, 'synthetic booking skipped');
    return;
  }
  if (consumer.ownInbox) await consumer.handle(event, db);
  else await handleOnce(db, consumer.name, event.id, () => consumer.handle(event, db));
}

/** Only the messages that failed go back to the queue. */
export async function handleBatch(consumer: Consumer, db: Db, records: readonly SQSRecord[]): Promise<SQSBatchResponse> {
  const failures: string[] = [];
  for (const record of records) {
    await Sentry.withIsolationScope(() =>
      runWithContext({}, async () => {
        try {
          await handleRecord(consumer, db, record);
        } catch (error) {
          failures.push(record.messageId);
          logger.error({ err: error, consumer: consumer.name, receives: record.attributes?.ApproximateReceiveCount }, 'message failed');
          Sentry.captureException(error, { tags: { consumer: consumer.name } });
        }
      }),
    );
  }
  await flushLogs();
  return { batchItemFailures: failures.map((itemIdentifier) => ({ itemIdentifier })) };
}
