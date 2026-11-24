import { CONTEXT, type EventRules, type HostSnapshot, type Interval, type Member } from '@rr/domain';
import type { EventType } from '@prisma/client';
import { AppError } from '../errors';
import type { Tx } from '../db';

export interface Rotation {
  readonly eventType: EventType;
  readonly rules: EventRules;
  readonly members: readonly Member[];
  readonly hosts: readonly HostSnapshot[];
  readonly names: ReadonlyMap<string, string>;
}

export function rulesOf(eventType: EventType): EventRules {
  const { durationMinutes, slotStepMinutes, bufferBeforeMinutes, bufferAfterMinutes } = eventType;
  const { minimumNoticeMinutes, horizonDays, dailyCapPerHost } = eventType;
  return {
    durationMinutes,
    slotStepMinutes,
    bufferBeforeMinutes,
    bufferAfterMinutes,
    minimumNoticeMinutes,
    horizonDays,
    dailyCapPerHost,
  };
}

/**
 * Serialises assignment inside one rotation until the transaction ends.
 * NO KEY UPDATE, because FOR UPDATE would also block inserts of bookings that reference the row.
 */
export async function lockRotation(tx: Tx, eventTypeId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM event_type WHERE id = ${eventTypeId}::uuid FOR NO KEY UPDATE`;
}

/** Held until the transaction ends. It only orders the inserts, the constraint does the refusing. */
export async function lockHost(tx: Tx, hostId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hostId}, 0))`;
}

export async function findEventType(tx: Tx, slug: string): Promise<EventType> {
  const eventType = await tx.eventType.findUnique({ where: { slug } });
  if (!eventType) throw new AppError('not_found', 'There is no scheduling link with that name');
  return eventType;
}

export async function loadRotation(tx: Tx, eventType: EventType, window: Interval): Promise<Rotation> {
  const from = new Date(window.from - CONTEXT);
  const to = new Date(window.to + CONTEXT);
  const rows = await tx.rotationMember.findMany({
    where: { eventTypeId: eventType.id, active: true },
    include: {
      host: {
        include: {
          hours: true,
          overrides: { where: { localDate: { gte: from, lte: to } } },
          busyBlocks: { where: { from: { lt: to }, to: { gt: from } } },
          bookings: {
            where: { status: 'CONFIRMED', blockedFrom: { lt: to }, blockedTo: { gt: from } },
            select: { start: true, blockedFrom: true, blockedTo: true },
          },
        },
      },
    },
  });

  return {
    eventType,
    rules: rulesOf(eventType),
    names: new Map(rows.map((r) => [r.hostId, r.host.name])),
    members: rows.map((r) => ({
      hostId: r.hostId,
      weight: r.weight,
      priority: r.priority,
      balance: r.balance,
      lastAssignedAt: r.lastAssignedAt?.getTime() ?? null,
    })),
    hosts: rows.map(({ host }) => ({
      hostId: host.id,
      schedule: {
        timeZone: host.timeZone,
        weekly: host.hours,
        overrides: Object.fromEntries(
          host.overrides.map((o) => [
            o.localDate.toISOString().slice(0, 10),
            o.windows as unknown as { startMinute: number; endMinute: number }[],
          ]),
        ),
      },
      busy: [
        ...host.bookings.map((b) => ({ from: b.blockedFrom.getTime(), to: b.blockedTo.getTime() })),
        ...host.busyBlocks.map((b) => ({ from: b.from.getTime(), to: b.to.getTime() })),
      ],
      meetingStarts: host.bookings.map((b) => b.start.getTime()),
    })),
  };
}
