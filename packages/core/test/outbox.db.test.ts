import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, type EventPublisher, OutboxRelay, StillRunning, db, handleOnce, outboxStatus, writeEvent } from '../src';
import { reset } from './fixtures';

beforeEach(() => reset());

const event = (): DomainEvent => ({
  id: randomUUID(),
  type: 'booking.confirmed',
  version: 1,
  aggregateId: randomUUID(),
  occurredAt: new Date().toISOString(),
  payload: {
    bookingId: randomUUID(),
    eventTypeSlug: 'demo',
    hostId: randomUUID(),
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    synthetic: false,
  },
});

class Recorder implements EventPublisher {
  seen: string[] = [];
  constructor(private readonly refuse: (e: DomainEvent) => boolean = () => false) {}
  async publish(events: readonly DomainEvent[]) {
    const bad = events.filter(this.refuse);
    this.seen.push(...events.filter((e) => !bad.includes(e)).map((e) => e.id));
    return bad.map((e) => e.id);
  }
}

const expireLeases = () => db().$executeRaw`UPDATE outbox_event SET claimed_until = now() - interval '1 second' WHERE published_at IS NULL`;

describe('outbox', () => {
  it('drops the event when the transaction rolls back', async () => {
    const attempt = db().$transaction(async (tx) => {
      await writeEvent(tx, event());
      throw new Error('rollback');
    });
    await expect(attempt).rejects.toThrow('rollback');
    expect(await db().outboxEvent.count()).toBe(0);
  });

  it('publishes in the order the events were written', async () => {
    const events = Array.from({ length: 23 }, event);
    for (const e of events) await writeEvent(db(), e);
    const bus = new Recorder();
    await new OutboxRelay(db(), bus).drain(Date.now() + 10_000);
    expect(bus.seen).toEqual(events.map((e) => e.id));
    expect((await outboxStatus(db())).pending).toBe(0);
  });

  it('three relays at once send every event exactly once', async () => {
    const events = Array.from({ length: 60 }, event);
    for (const e of events) await writeEvent(db(), e);
    const bus = new Recorder();
    await Promise.all([1, 2, 3].map(() => new OutboxRelay(db(), bus).drain(Date.now() + 10_000)));
    expect(bus.seen).toHaveLength(60);
    expect(new Set(bus.seen).size).toBe(60);
  });

  it('keeps only the refused event and sends it later', async () => {
    const events = [event(), event(), event()];
    for (const e of events) await writeEvent(db(), e);
    const picky = new Recorder((e) => e.id === events[1]!.id);
    await new OutboxRelay(db(), picky).drainOnce();
    expect(picky.seen).toEqual([events[0]!.id, events[2]!.id]);
    expect(await outboxStatus(db())).toMatchObject({ pending: 1 });

    const bus = new Recorder();
    await new OutboxRelay(db(), bus).drainOnce();
    expect(bus.seen).toEqual([]);
    await expireLeases();
    await new OutboxRelay(db(), bus).drainOnce();
    expect(bus.seen).toEqual([events[1]!.id]);
  });

  it('a bus outage loses nothing, and a relay that died after sending sends again', async () => {
    const e = event();
    await writeEvent(db(), e);
    const down: EventPublisher = { publish: () => Promise.reject(new Error('bus is down')) };
    await new OutboxRelay(db(), down).drainOnce();
    await expireLeases();

    // Sent, but the process is gone before it can mark the row.
    const bus = new Recorder();
    const dies: EventPublisher = { publish: async (es) => (await bus.publish(es), es.map((x) => x.id)) };
    await new OutboxRelay(db(), dies).drainOnce();
    await expireLeases();
    await new OutboxRelay(db(), bus).drainOnce();
    expect(bus.seen).toEqual([e.id, e.id]);
  });
});

describe('inbox', () => {
  it('drops repeats per consumer, not across consumers', async () => {
    const id = randomUUID();
    let runs = 0;
    const work = async () => void runs++;
    expect(await handleOnce(db(), 'email', id, work)).toBe('done');
    expect(await handleOnce(db(), 'email', id, work)).toBe('duplicate');
    expect(await handleOnce(db(), 'webhooks', id, work)).toBe('done');
    expect(runs).toBe(2);
  });

  it('runs once when ten copies arrive together', async () => {
    const id = randomUUID();
    let runs = 0;
    const work = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 100));
    };
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => handleOnce(db(), 'email', id, work)));
    expect(runs).toBe(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(StillRunning);
    expect(await handleOnce(db(), 'email', id, work)).toBe('duplicate');
  });

  it('lets a failed message through again', async () => {
    const id = randomUUID();
    await expect(handleOnce(db(), 'email', id, () => Promise.reject(new Error('smtp')))).rejects.toThrow('smtp');
    expect(await handleOnce(db(), 'email', id, async () => {})).toBe('done');
  });
});
