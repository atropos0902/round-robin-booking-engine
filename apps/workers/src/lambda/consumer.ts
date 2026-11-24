import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import * as Sentry from '@sentry/aws-serverless';
import { db } from '@rr/core';
import { ready } from '../runtime';
import { type ConsumerName, createConsumer } from '../consumers';
import { type Consumer, handleBatch } from '../consumers/consumer';

let consumer: Consumer | undefined;

export const handler = Sentry.wrapHandler(async (event: SQSEvent): Promise<SQSBatchResponse> => {
  await ready();
  consumer ??= createConsumer(process.env.CONSUMER as ConsumerName);
  return handleBatch(consumer, db(), event.Records);
});
