import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { TURN } from '@rr/domain';
import { AppError, BookingService, SlotService, db, sqlState } from '../src';
import { lockHost } from '../src/booking/rotation';
import { NINE_TO_FIVE, NOON, at, host, invitee, reset, rotation } from './fixtures';

const bookings = new BookingService(db());
const slots = new SlotService(db());
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AppError ? e.code : `unexpected: ${e}`));

beforeEach(() => reset());

async function overlapsInDatabase(): Promise<number> {
  const [row] = await db().$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM booking a JOIN booking b
      ON a.host_id = b.host_id AND a.id < b.id AND a.status = 'CONFIRMED' AND b.status = 'CONFIRMED'
     AND a.blocked_from < b.blocked_to AND b.blocked_from < a.blocked_to`;
  return row!.n;
}

describe('booking', () => {
  it('saves the meeting, the reason and the event together', async () => {
    const [a, b] = [await host('Ana'), await host('Ben')];
    await rotation('demo', [{ id: a.id, weight: 2 }, { id: b.id }]);
    const booked = await bookings.book({ slug: 'demo', start: at(0), invitee });

    expect(booked.host.name).toBe('Ana');
    const why = await bookings.explain(booked.id);
    expect(why.reasons[0]).toContain('Ana took the meeting');
    expect(why.reasons[1]).toContain('Ben was free too');
    const events = await db().outboxEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'booking.confirmed', aggregateId: booked.id, publishedAt: null });
  });

  it('refuses times that were never offered', async () => {
    const a = await host('Ana', 'America/New_York', NINE_TO_FIVE);
    await rotation('demo', [{ id: a.id }], { minimumNoticeMinutes: 60, horizonDays: 14 });
    expect(await code(bookings.book({ slug: 'demo', start: at(7), invitee }))).toBe('invalid_slot');
    expect(await code(bookings.book({ slug: 'demo', start: at(-30 * 24 * 60), invitee }))).toBe('invalid_slot');
    expect(await code(bookings.book({ slug: 'demo', start: at(30 * 24 * 60), invitee }))).toBe('invalid_slot');
    expect(await code(bookings.book({ slug: 'demo', start: at(-12 * 60), invitee }))).toBe('no_host_available');
    expect(await code(bookings.book({ slug: 'nope', start: at(0), invitee }))).toBe('not_found');
    expect(await db().outboxEvent.count()).toBe(0);
  });

  it('a slot that is listed can be booked, and is then gone', async () => {
    const a = await host('Ana', 'Pacific/Auckland', NINE_TO_FIVE);
    await rotation('demo', [{ id: a.id }], { bufferAfterMinutes: 10, bufferBeforeMinutes: 5 });
    const range = [new Date(NOON - 24 * 3600_000), new Date(NOON + 24 * 3600_000)] as const;
    const { slots: before } = await slots.open('demo', ...range);
    expect(before.length).toBeGreaterThan(10);
    await bookings.book({ slug: 'demo', start: new Date(before[4]!), invitee });
    const { slots: after } = await slots.open('demo', ...range);
    // The neighbours go too, because the buffers reach into them.
    const row = await db().booking.findFirstOrThrow();
    expect(row.start.getTime() - row.blockedFrom.getTime()).toBe(5 * 60_000);
    expect(row.blockedTo.getTime() - row.end.getTime()).toBe(10 * 60_000);
    expect(after).toEqual(before.filter((s) => ![before[3], before[4], before[5]].includes(s)));
  });

  it('cuts the week at midnight in the customer zone', async () => {
    const a = await host('Ana');
    await rotation('demo', [{ id: a.id }]);
    const start = new Date(NOON).toISOString().slice(0, 10);
    const week = await slots.week('demo', start, 'Pacific/Kiritimati');
    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      for (const s of day.slots) {
        const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date(s));
        expect(local).toBe(day.date);
      }
      expect(day.slots).toHaveLength(48);
    }
  });

  it('cancelling frees the slot and gives the turn back', async () => {
    const hosts = [await host('Ana'), await host('Ben'), await host('Cleo')];
    const type = await rotation('demo', hosts.map((h, i) => ({ id: h.id, weight: i + 1 })));
    for (let i = 0; i < 4; i++) await bookings.book({ slug: 'demo', start: at(i * 30), invitee });
    const before = await db().rotationMember.findMany({ where: { eventTypeId: type.id }, orderBy: { hostId: 'asc' } });
    const b = await bookings.book({ slug: 'demo', start: at(300), invitee });
    await bookings.cancel({ manageToken: b.manageToken });
    const after = await db().rotationMember.findMany({ where: { eventTypeId: type.id }, orderBy: { hostId: 'asc' } });
    expect(after.map((m) => m.balance)).toEqual(before.map((m) => m.balance));
    expect(await code(bookings.cancel({ id: b.id }))).toBe('already_cancelled');
    expect((await bookings.book({ slug: 'demo', start: at(300), invitee })).host.id).toBe(b.host.id);
  });

  it('does not let two cancellations both give the turn back', async () => {
    const a = await host('Ana');
    const b = await host('Ben');
    const type = await rotation('demo', [{ id: a.id }, { id: b.id }]);
    const booked = await bookings.book({ slug: 'demo', start: at(0), invitee });
    const results = await Promise.all(Array.from({ length: 6 }, () => code(bookings.cancel({ id: booked.id }))));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    const rows = await db().rotationMember.findMany({ where: { eventTypeId: type.id } });
    expect(rows.map((r) => r.balance)).toEqual([0, 0]);
    expect(await db().outboxEvent.count({ where: { type: 'booking.cancelled' } })).toBe(1);
  });
});

describe('idempotency', () => {
  it('returns the first booking for a repeated key, even when all repeats arrive together', async () => {
    const hosts = [await host('Ana'), await host('Ben'), await host('Cleo')];
    await rotation('demo', hosts);
    const key = randomUUID();
    const all = await Promise.all(
      Array.from({ length: 10 }, () => bookings.book({ slug: 'demo', start: at(0), invitee, idempotencyKey: key })),
    );
    expect(new Set(all.map((b) => b.id)).size).toBe(1);
    expect(await db().booking.count()).toBe(1);
  });

  it('survives the same key sent to two rotations at once', async () => {
    const [a, b] = [await host('Ana'), await host('Ben')];
    await rotation('one', [a]);
    await rotation('two', [b]);
    const key = randomUUID();
    const results = await Promise.all(
      ['one', 'two'].map((slug) => code(bookings.book({ slug, start: at(0), invitee, idempotencyKey: key }))),
    );
    expect(results.sort()).toEqual(['idempotency_mismatch', 'ok']);
  });

  it('refuses a key that belongs to another request', async () => {
    const a = await host('Ana');
    await rotation('demo', [a]);
    await bookings.book({ slug: 'demo', start: at(0), invitee, idempotencyKey: 'same-key-1' });
    expect(await code(bookings.book({ slug: 'demo', start: at(60), invitee, idempotencyKey: 'same-key-1' }))).toBe('idempotency_mismatch');
  });
});

describe('races', () => {
  it('one rotation: every host is used once and the rest are told the time is gone', async () => {
    const hosts = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => host(n)));
    await rotation('demo', hosts);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => code(bookings.book({ slug: 'demo', start: at(0), invitee }))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(5);
    expect(results.filter((r) => r === 'no_host_available')).toHaveLength(15);
    expect(await overlapsInDatabase()).toBe(0);
  });

  it('one rotation: parallel bookings at different times still share the turns by weight', async () => {
    const hosts = await Promise.all(['A', 'B', 'C'].map((n) => host(n)));
    const type = await rotation('demo', hosts.map((h, i) => ({ id: h.id, weight: 3 - i })));
    await Promise.all(Array.from({ length: 24 }, (_, i) => bookings.book({ slug: 'demo', start: at(i * 30 - 360), invitee })));
    const counts = await Promise.all(hosts.map((h) => db().booking.count({ where: { hostId: h.id } })));
    expect(counts).toEqual([12, 8, 4]);
    const members = await db().rotationMember.findMany({ where: { eventTypeId: type.id } });
    expect(members.reduce((s, m) => s + m.balance, 0)).toBe(0);
    for (const m of members) expect(Math.abs(m.balance)).toBeLessThan(TURN);
  });

  it('two rotations sharing a host: the loser gets the next host, with the reason on record', async () => {
    let retried = 0;
    for (let round = 0; round < 15; round++) {
      await reset();
      const shared = await host('Shared');
      const [left, right] = [await host('Left'), await host('Right')];
      // Both rotations want the shared host first.
      await rotation('one', [{ id: shared.id, priority: 1 }, { id: left.id }]);
      await rotation('two', [{ id: shared.id, priority: 1 }, { id: right.id }]);
      const results = await Promise.all(['one', 'two'].map((slug) => bookings.book({ slug, start: at(0), invitee })));
      expect(results.filter((r) => r.host.id === shared.id)).toHaveLength(1);
      expect(await overlapsInDatabase()).toBe(0);
      for (const r of results) {
        const why = await bookings.explain(r.id);
        if (why.attempts > 1) {
          retried++;
          expect(why.reasons.join(' ')).toContain('Shared was booked through another link at the same moment');
        }
      }
    }
    // If this never happens the test is not exercising the race.
    expect(retried).toBeGreaterThan(0);
  });

  it('eight rotations after one host: nobody waits on a deadlock', async () => {
    for (let round = 0; round < 20; round++) {
      await reset();
      const shared = await host('Shared');
      const own = await Promise.all(Array.from({ length: 8 }, (_, i) => host(`Own${i}`)));
      for (const [i, h] of own.entries()) await rotation(`r${i}`, [{ id: shared.id, priority: 1 }, { id: h.id }]);
      const results = await Promise.all(own.map((_, i) => code(bookings.book({ slug: `r${i}`, start: at(0), invitee }))));
      expect(results).toEqual(Array(8).fill('ok'));
      expect(await db().booking.count({ where: { hostId: shared.id } })).toBe(1);
    }
  });

  it('queues behind the host lock before it inserts', async () => {
    const a = await host('Ana');
    await rotation('demo', [a]);
    let finished = false;
    let booking: Promise<unknown> | undefined;
    await db().$transaction(async (tx) => {
      await lockHost(tx, a.id);
      booking = bookings.book({ slug: 'demo', start: at(0), invitee }).then(() => (finished = true));
      await new Promise((r) => setTimeout(r, 600));
      expect(finished).toBe(false);
    });
    await booking;
    expect(finished).toBe(true);
  });

  it('many rotations, few hosts, overlapping buffers: nobody is ever double-booked', async () => {
    const hosts = await Promise.all(['A', 'B', 'C', 'D'].map((n) => host(n)));
    for (let i = 0; i < 4; i++) {
      await rotation(`r${i}`, hosts.map((h, j) => ({ id: h.id, weight: 1 + ((i + j) % 3) })), {
        bufferBeforeMinutes: i * 5,
        bufferAfterMinutes: 10,
      });
    }
    const results = await Promise.all(
      Array.from({ length: 64 }, (_, i) => code(bookings.book({ slug: `r${i % 4}`, start: at((i % 8) * 30), invitee }))),
    );
    expect(results.filter((r) => r !== 'ok' && r !== 'no_host_available')).toEqual([]);
    expect(results.filter((r) => r === 'ok').length).toBeGreaterThan(8);
    expect(await overlapsInDatabase()).toBe(0);
  });

  it('the constraint holds on its own, without the engine in front of it', async () => {
    const a = await host('Ana');
    const type = await rotation('demo', [a]);
    const data = {
      eventTypeId: type.id,
      hostId: a.id,
      start: at(0),
      end: at(30),
      blockedFrom: at(-5),
      blockedTo: at(40),
      inviteeName: 'x',
      inviteeEmail: 'x@example.test',
      inviteeZone: 'UTC',
    };
    await db().booking.create({ data });
    const second = db().booking.create({ data: { ...data, start: at(35), end: at(60), blockedFrom: at(35), blockedTo: at(60) } });
    expect(await second.catch(sqlState)).toBe('23P01');
    await db().booking.create({ data: { ...data, start: at(40), end: at(60), blockedFrom: at(40), blockedTo: at(60) } });
    await db().booking.create({ data: { ...data, status: 'CANCELLED' } });
  });
});
