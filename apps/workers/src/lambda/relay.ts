import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { Context } from 'aws-lambda';
import * as Sentry from '@sentry/aws-serverless';
import { OutboxRelay, db, flushLogs, logger, outboxStatus } from '@rr/core';
import { ready } from '../runtime';
import { EventBridgePublisher } from '../publishers';

const PAUSE = 2_000;
const MARGIN = 8_000;

/** Started every minute. Stays for most of it, so an event waits seconds and not a minute. */
export const handler = Sentry.wrapHandler(async (_event: unknown, context: Context) => {
  await ready();
  const relay = new OutboxRelay(db(), new EventBridgePublisher(new EventBridgeClient({}), process.env.EVENT_BUS_NAME!));
  const deadline = Date.now() + context.getRemainingTimeInMillis() - MARGIN;
  let published = 0;
  while (Date.now() < deadline) {
    published += await relay.drain(deadline);
    await new Promise((resolve) => setTimeout(resolve, PAUSE));
  }
  const status = await outboxStatus(db());
  // A metric filter in the stack reads outboxAge and raises the alarm.
  logger.info({ published, outboxAge: status.oldestSeconds, outboxPending: status.pending }, 'relay finished');
  await flushLogs();
});
