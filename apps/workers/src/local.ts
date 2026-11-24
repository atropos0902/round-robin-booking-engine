import { DeleteMessageCommand, GetQueueUrlCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSRecord } from 'aws-lambda';
import { OutboxRelay, db, logger } from '@rr/core';
import { ready } from './runtime';
import { CONSUMERS, createConsumer } from './consumers';
import { handleBatch } from './consumers/consumer';
import { FanOutPublisher } from './publishers';

/** Runs the relay and the three consumers against local queues, with the same code Lambda runs. */
export async function startLocal(options: { pause?: number; waitSeconds?: number; prefix?: string } = {}) {
  await ready();
  const sqs = new SQSClient({
    endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:59324',
    region: 'elasticmq',
    credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
  });
  const url = async (name: string) =>
    (await sqs.send(new GetQueueUrlCommand({ QueueName: `${options.prefix ?? ''}${name}` }))).QueueUrl!;
  const queues = await Promise.all(CONSUMERS.map(async (name) => ({ consumer: createConsumer(name), queueUrl: await url(name) })));
  const relay = new OutboxRelay(db(), new FanOutPublisher(sqs, queues.map((q) => q.queueUrl)));

  let running = true;
  const forever = async (work: () => Promise<void>) => {
    while (running) {
      await work().catch((error) => logger.error({ err: error }, 'local worker'));
      await new Promise((resolve) => setTimeout(resolve, options.pause ?? 500));
    }
  };
  const loops = [
    forever(async () => void (await relay.drain(Date.now() + 5_000))),
    ...queues.map(({ consumer, queueUrl }) =>
      forever(async () => {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: options.waitSeconds ?? 2 }),
        );
        if (Messages.length === 0) return;
        const records = Messages.map((m) => ({ messageId: m.MessageId!, body: m.Body!, attributes: {} }) as SQSRecord);
        const { batchItemFailures } = await handleBatch(consumer, db(), records);
        const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
        for (const m of Messages.filter((x) => !failed.has(x.MessageId!))) {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
        }
      }),
    ),
  ];
  return {
    sqs,
    url,
    stop: async () => {
      running = false;
      await Promise.all(loops);
    },
  };
}

if (require.main === module) {
  startLocal().then(
    () => logger.info('relay and consumers are running'),
    (error) => {
      logger.error({ err: error }, 'could not start');
      process.exit(1);
    },
  );
}
