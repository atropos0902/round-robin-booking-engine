import { GetQueueAttributesCommand, GetQueueUrlCommand, SQSClient, StartMessageMoveTaskCommand } from '@aws-sdk/client-sqs';
import { CONSUMERS } from './consumers';

/** npm run replay-dlq -- email [queue prefix]. Moves the dead letters back to the queue they came from. */
export async function replay(sqs: SQSClient, name: string, prefix = ''): Promise<number> {
  const attributes = async (QueueName: string) => {
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName }));
    const result = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages'] }),
    );
    return result.Attributes!;
  };
  const dead = await attributes(`${prefix}${name}-dlq`);
  const count = Number(dead.ApproximateNumberOfMessages);
  if (count === 0) return 0;
  const target = await attributes(`${prefix}${name}`);
  await sqs.send(new StartMessageMoveTaskCommand({ SourceArn: dead.QueueArn!, DestinationArn: target.QueueArn! }));
  return count;
}

if (require.main === module) {
  const [name = '', prefix] = process.argv.slice(2);
  if (!CONSUMERS.some((c) => c === name)) {
    console.error(`Name one of: ${CONSUMERS.join(', ')}`);
    process.exit(2);
  }
  const local = process.env.SQS_ENDPOINT;
  const sqs = local
    ? new SQSClient({ endpoint: local, region: 'elasticmq', credentials: { accessKeyId: 'x', secretAccessKey: 'x' } })
    : new SQSClient({});
  replay(sqs, name, prefix).then((n) => console.log(n === 0 ? 'The dead-letter queue is empty' : `Moving ${n} messages back to ${name}`));
}
