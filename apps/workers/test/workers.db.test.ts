import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CreateQueueCommand, GetQueueAttributesCommand, PurgeQueueCommand, SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import type { SQSRecord } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BookingService, type DomainEvent, db, domainEvent } from '@rr/core';
import { at, host, invitee, reset, rotation } from '../../../packages/core/test/fixtures';
import { CONSUMERS } from '../src/consumers';
import { CalendarSync } from '../src/consumers/calendar-sync';
import { handleBatch } from '../src/consumers/consumer';
import { EmailConsumer, type Mail } from '../src/consumers/email';
import { ics } from '../src/consumers/ics';
import { WebhookConsumer } from '../src/consumers/webhooks';
import { startLocal } from '../src/local';
import { EventBridgePublisher } from '../src/publishers';
import { replay } from '../src/replay-dlq';

const bookings = new BookingService(db());
const closers: (() => unknown)[] = [];
beforeEach(() => reset());
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

interface Hit {
  method: string;
  url: string;
  body: string;
  headers: http.IncomingHttpHeaders;
}

async function server(status: (hit: Hit) => number = () => 200) {
  const hits: Hit[] = [];
  const s = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const hit = { method: req.method!, url: req.url!, body, headers: req.headers };
    hits.push(hit);
    res.writeHead(status(hit)).end();
  });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => (s.closeAllConnections(), s.close(r))));
  return { hits, url: `http://127.0.0.1:${(s.address() as { port: number }).port}` };
}

async function booked(calendarUrl?: string) {
  const a = await host('Ana');
  if (calendarUrl) await db().host.update({ where: { id: a.id }, data: { calendarUrl } });
  await rotation('demo', [a]);
  return bookings.book({ slug: 'demo', start: at(0), invitee });
}

async function events(): Promise<DomainEvent[]> {
  const rows = await db().outboxEvent.findMany({ orderBy: { seq: 'asc' } });
  return rows.map((r) => domainEvent.parse({ ...r, occurredAt: r.occurredAt.toISOString() }));
}

const record = (event: unknown): SQSRecord =>
  ({ messageId: randomUUID(), body: JSON.stringify({ detail: event }), attributes: {} }) as SQSRecord;

const until = async (check: () => Promise<boolean> | boolean, ms = 20_000) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('waited too long');
};

describe('event bus', () => {
  it('reports exactly the entries EventBridge rejected', async () => {
    await booked();
    const [event] = await events();
    const list = [1, 2, 3].map(() => ({ ...event!, id: randomUUID() }));
    const mock = mockClient(EventBridgeClient);
    mock.on(PutEventsCommand).resolves({
      FailedEntryCount: 1,
      Entries: [{ EventId: 'a' }, { ErrorCode: 'InternalFailure', ErrorMessage: 'no' }, { EventId: 'c' }],
    });
    const failed = await new EventBridgePublisher(new EventBridgeClient({ region: 'eu-west-1' }), 'bus').publish(list);
    expect(failed).toEqual([list[1]!.id]);
    const entry = mock.commandCalls(PutEventsCommand)[0]!.args[0].input.Entries![0]!;
    expect(entry).toMatchObject({ EventBusName: 'bus', Source: 'rr.booking', DetailType: 'booking.confirmed' });
    mock.restore();
  });
});

describe('batches', () => {
  it('return only the failed messages, and a broken body is one of them', async () => {
    await booked();
    const [event] = await events();
    const mails: Mail[] = [];
    const good = record(event);
    const broken = { ...record({}), body: 'not json' };
    const wrongShape = record({ ...event, version: 2 });
    const result = await handleBatch(new EmailConsumer(async (m) => void mails.push(m), 'https://x.test'), db(), [broken, good, wrongShape]);
    expect(result.batchItemFailures.map((f) => f.itemIdentifier)).toEqual([broken.messageId, wrongShape.messageId]);
    expect(mails).toHaveLength(1);
  });

  it('a repeat sends no second mail', async () => {
    await booked();
    const [event] = await events();
    const mails: Mail[] = [];
    const consumer = new EmailConsumer(async (m) => void mails.push(m), 'https://x.test');
    for (let i = 0; i < 3; i++) await handleBatch(consumer, db(), [record(event)]);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('(Asia/Kolkata)');
    expect(mails[0]!.text).toMatch(/5:30.PM/);
  });

  it('a synthetic booking reaches nobody', async () => {
    await booked();
    const [event] = await events();
    const mails: Mail[] = [];
    const synthetic = { ...event!, payload: { ...event!.payload, synthetic: true } };
    const result = await handleBatch(new EmailConsumer(async (m) => void mails.push(m), 'x'), db(), [record(synthetic)]);
    expect(result.batchItemFailures).toEqual([]);
    expect(mails).toEqual([]);
  });
});

describe('calendar', () => {
  it('a late confirmation does not bring back a cancelled meeting', async () => {
    const calendar = await server();
    const b = await booked(`${calendar.url}/cal/`);
    await bookings.cancel({ id: b.id });
    const [confirmed, cancelled] = await events();
    await handleBatch(new CalendarSync(), db(), [record(cancelled), record(confirmed)]);
    expect(calendar.hits.map((h) => h.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('a cancellation that lands during the write is noticed', async () => {
    const calendar = await server();
    const b = await booked(`${calendar.url}/cal`);
    const [confirmed] = await events();
    let first = true;
    const slow: typeof fetch = async (...args) => {
      if (first) {
        first = false;
        await bookings.cancel({ id: b.id });
      }
      return fetch(...args);
    };
    await handleBatch(new CalendarSync(slow), db(), [record(confirmed)]);
    expect(calendar.hits.map((h) => `${h.method} ${h.url}`)).toEqual([`PUT /cal/${b.id}.ics`, `DELETE /cal/${b.id}.ics`]);
  });

  it('writes lines no longer than 75 bytes and escapes what it must', () => {
    const text = ics({
      uid: 'u',
      title: 'Ünïcode; with, commas\\ and\nbreaks '.repeat(6),
      start: at(0),
      end: at(30),
      description: 'd',
      stamp: at(0),
    });
    for (const line of text.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    const summary = text.replace(/\r\n /g, '').split('\r\n').find((l) => l.startsWith('SUMMARY:'))!;
    expect(summary).toContain('Ünïcode\\; with\\, commas\\\\ and\\nbreaks');
  });
});

describe('webhooks', () => {
  it('one broken endpoint is retried without repeating the others', async () => {
    let down = true;
    const good = await server();
    const bad = await server(() => (down ? 500 : 200));
    await db().webhookSubscription.createMany({
      data: [
        { url: good.url, secret: 's1' },
        { url: bad.url, secret: 's2' },
      ],
    });
    await booked();
    const [event] = await events();
    const consumer = new WebhookConsumer();
    expect((await handleBatch(consumer, db(), [record(event)])).batchItemFailures).toHaveLength(1);
    down = false;
    expect((await handleBatch(consumer, db(), [record(event)])).batchItemFailures).toHaveLength(0);
    expect(good.hits).toHaveLength(1);
    expect(bad.hits).toHaveLength(2);

    const { headers, body } = good.hits[0]!;
    const [, t, v1] = /t=(\d+),v1=([0-9a-f]+)/.exec(headers['x-signature'] as string)!;
    expect(v1).toBe(createHmac('sha256', 's1').update(`${t}.${body}`).digest('hex'));
  });
});

describe('end to end over real queues', () => {
  const depth = async (sqs: SQSClient, QueueUrl: string) => {
    const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['All'] }));
    return Number(Attributes!.ApproximateNumberOfMessages) + Number(Attributes!.ApproximateNumberOfMessagesNotVisible);
  };

  // Queues of their own, so workers running on the same machine do not take the messages.
  async function createQueues(prefix: string) {
    const sqs = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:59324',
      region: 'elasticmq',
      credentials: { accessKeyId: 'x', secretAccessKey: 'x' },
    });
    for (const name of CONSUMERS) {
      const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}${name}-dlq` }));
      const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
      const RedrivePolicy = JSON.stringify({ deadLetterTargetArn: Attributes!.QueueArn, maxReceiveCount: 3 });
      await sqs.send(
        new CreateQueueCommand({ QueueName: `${prefix}${name}`, Attributes: { VisibilityTimeout: '2', RedrivePolicy } }),
      );
    }
  }

  it('a booking reaches the calendar and the webhook, a poison message ends up dead and can be replayed', async () => {
    let down = false;
    const calendar = await server();
    const hook = await server(() => (down ? 503 : 200));
    await db().webhookSubscription.create({ data: { url: hook.url, secret: 's' } });

    const prefix = 'test-';
    await createQueues(prefix);
    const local = await startLocal({ pause: 50, waitSeconds: 0, prefix });
    closers.push(local.stop);
    for (const q of ['calendar-sync', 'email', 'webhooks', 'webhooks-dlq', 'calendar-sync-dlq', 'email-dlq']) {
      await local.sqs.send(new PurgeQueueCommand({ QueueUrl: await local.url(q) }));
    }

    const b = await booked(`${calendar.url}/cal`);
    await until(() => calendar.hits.length === 1 && hook.hits.length === 1);
    expect(calendar.hits[0]!.body).toContain(`UID:${b.id}`);
    expect(JSON.parse(hook.hits[0]!.body).payload.bookingId).toBe(b.id);

    const poison = { QueueUrl: await local.url('email'), MessageBody: 'not json' };
    await local.sqs.send(new SendMessageCommand(poison));
    down = true;
    await bookings.cancel({ id: b.id });
    await until(() => calendar.hits.length === 2);
    expect(calendar.hits[1]!.method).toBe('DELETE');

    const dlq = await local.url('webhooks-dlq');
    await until(async () => (await depth(local.sqs, dlq)) === 1, 40_000);
    await until(async () => (await depth(local.sqs, await local.url('email-dlq'))) === 1, 40_000);

    down = false;
    const before = hook.hits.length;
    expect(await replay(local.sqs, 'webhooks', prefix)).toBe(1);
    await until(() => hook.hits.length === before + 1);
    expect(JSON.parse(hook.hits.at(-1)!.body).type).toBe('booking.cancelled');
    await until(async () => (await depth(local.sqs, dlq)) === 0);
  }, 90_000);
});
