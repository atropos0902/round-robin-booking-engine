import { randomUUID } from 'node:crypto';
import {
  type Decision,
  type SkipReason,
  assign,
  availabilityAt,
  blockedRange,
  cancellationProblem,
  explain,
  meeting,
  slotProblem,
  undo,
} from '@rr/domain';
import type { Booking, Prisma } from '@prisma/client';
import type { BookCommand, DomainEvent } from '../contracts';
import { type Db, type Tx, sqlState } from '../db';
import { AppError } from '../errors';
import { addContext, logger } from '../observability/logger';
import { writeEvent } from '../outbox/outbox';
import { findEventType, loadRotation, lockHost, lockRotation } from './rotation';

const EXCLUSION_VIOLATION = '23P01';
const UNIQUE_VIOLATION = '23505';

const PROBLEMS = {
  off_grid: 'That time is not one of the offered slots',
  too_soon: 'That time is too close to now',
  too_far: 'That time is too far ahead',
} as const;

export interface BookingView {
  id: string;
  status: 'CONFIRMED' | 'CANCELLED';
  slug: string;
  title: string;
  start: string;
  end: string;
  host: { id: string; name: string };
  invitee: { name: string; timeZone: string };
}

/** Raised inside the transaction so it rolls back, caught by the loop that tries the next host. */
class HostTaken extends Error {
  constructor(readonly hostId: string) {
    super(`host ${hostId} was taken by another transaction`);
  }
}

/** Same idempotency key as an earlier booking. */
class AlreadyBooked extends Error {}

export class BookingService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async book(command: BookCommand): Promise<BookingView & { manageToken: string }> {
    const lost = new Set<string>();
    for (let attempt = 1; ; attempt++) {
      const id = randomUUID();
      try {
        await this.db.$transaction((tx) => this.tryBook(tx, id, command, lost, attempt), {
          maxWait: 10_000,
          timeout: 15_000,
        });
        addContext({ bookingId: id });
        logger.info({ attempt }, 'booking confirmed');
        return await this.byId(id);
      } catch (error) {
        // The key can belong to a booking from another rotation, which the row lock does not cover.
        if (command.idempotencyKey && sqlState(error) === UNIQUE_VIOLATION) return this.replay(command);
        if (error instanceof AlreadyBooked) return this.replay(command);
        if (!(error instanceof HostTaken)) throw error;
        lost.add(error.hostId);
        logger.info({ attempt, hostId: error.hostId }, 'host lost to another transaction, trying the next one');
      }
    }
  }

  private async tryBook(tx: Tx, id: string, command: BookCommand, lost: ReadonlySet<string>, attempt: number) {
    const eventType = await findEventType(tx, command.slug);
    await lockRotation(tx, eventType.id);

    if (command.idempotencyKey) {
      const earlier = await tx.booking.findUnique({ where: { idempotencyKey: command.idempotencyKey } });
      if (earlier) throw new AlreadyBooked();
    }

    const start = command.start.getTime();
    const now = this.now();
    // Read after the lock: these balances are the ones the decision is made on.
    const rotation = await loadRotation(tx, await findEventType(tx, command.slug), { from: start, to: start });
    const problem = slotProblem(rotation.rules, start, now);
    if (problem) throw new AppError('invalid_slot', PROBLEMS[problem]);

    const availability = new Map<string, SkipReason | null>(availabilityAt(rotation.rules, rotation.hosts, start));
    for (const hostId of lost) if (availability.has(hostId)) availability.set(hostId, 'lost_race');

    const decision = assign(rotation.members, availability);
    if (!decision) throw new AppError('no_host_available', 'That time was just taken');

    const { to: end } = meeting(rotation.rules, start);
    const blocked = blockedRange(rotation.rules, start);
    // Two inserts that exclude each other wait on each other, which Postgres resolves as a deadlock
    // after a second. Queueing per host first turns that into a plain constraint error, at once.
    await lockHost(tx, decision.hostId);
    try {
      await tx.booking.create({
        data: {
          id,
          eventTypeId: eventType.id,
          hostId: decision.hostId,
          start: new Date(start),
          end: new Date(end),
          blockedFrom: new Date(blocked.from),
          blockedTo: new Date(blocked.to),
          inviteeName: command.invitee.name,
          inviteeEmail: command.invitee.email,
          inviteeZone: command.invitee.timeZone,
          idempotencyKey: command.idempotencyKey,
        },
      });
    } catch (error) {
      if (sqlState(error) === EXCLUSION_VIOLATION) throw new HostTaken(decision.hostId);
      throw error;
    }

    await tx.assignmentDecision.create({
      data: { bookingId: id, decision: decision as unknown as Prisma.InputJsonValue, attempts: attempt },
    });
    for (const c of decision.candidates) {
      await tx.rotationMember.update({
        where: { eventTypeId_hostId: { eventTypeId: eventType.id, hostId: c.hostId } },
        data: {
          balance: c.balanceAfter,
          ...(c.hostId === decision.hostId ? { lastAssignedAt: new Date(now) } : {}),
        },
      });
    }
    await writeEvent(tx, this.event('booking.confirmed', id, decision.hostId, start, end, eventType, now));
  }

  async cancel(where: { id: string } | { manageToken: string }): Promise<BookingView> {
    const found = await this.db.booking.findUnique({ where, include: { eventType: true } });
    if (!found) throw new AppError('not_found', 'There is no such booking');
    addContext({ bookingId: found.id });

    await this.db.$transaction(
      async (tx) => {
        // Same order as book(): the rotation first, then the booking.
        await lockRotation(tx, found.eventTypeId);
        const booking = await tx.booking.findUniqueOrThrow({ where: { id: found.id }, include: { decision: true } });
        const now = this.now();
        const problem = cancellationProblem({ status: booking.status, start: booking.start.getTime() }, now);
        if (problem === 'already_cancelled') throw new AppError(problem, 'This meeting is already cancelled');
        if (problem === 'already_started') throw new AppError(problem, 'This meeting has already started');

        await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
        if (booking.decision) {
          for (const [hostId, change] of undo(booking.decision.decision as unknown as Decision)) {
            // updateMany, because the host may have left the rotation since.
            await tx.rotationMember.updateMany({
              where: { eventTypeId: booking.eventTypeId, hostId },
              data: { balance: { increment: change } },
            });
          }
        }
        await writeEvent(
          tx,
          this.event('booking.cancelled', booking.id, booking.hostId, booking.start.getTime(), booking.end.getTime(), found.eventType, now),
        );
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
    logger.info('booking cancelled');
    return this.view(found.id);
  }

  async view(id: string): Promise<BookingView> {
    const { manageToken: _, ...view } = await this.byId(id);
    return view;
  }

  async viewByToken(manageToken: string): Promise<BookingView> {
    const row = await this.db.booking.findUnique({ where: { manageToken }, select: { id: true } });
    if (!row) throw new AppError('not_found', 'There is no such booking');
    return this.view(row.id);
  }

  /** Why this host? Read back from what was saved when the decision was made. */
  async explain(id: string): Promise<{ bookingId: string; hostId: string; attempts: number; reasons: string[] }> {
    const row = await this.db.assignmentDecision.findUnique({ where: { bookingId: id } });
    if (!row) throw new AppError('not_found', 'There is no such booking');
    const decision = row.decision as unknown as Decision;
    const ids = [...decision.candidates, ...decision.skipped].map((x) => x.hostId);
    const hosts = await this.db.host.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(hosts.map((h) => [h.id, h.name]));
    return {
      bookingId: id,
      hostId: decision.hostId,
      attempts: row.attempts,
      reasons: explain(decision, (hostId) => names.get(hostId) ?? 'A former host'),
    };
  }

  private async replay(command: BookCommand): Promise<BookingView & { manageToken: string }> {
    const row = await this.db.booking.findUniqueOrThrow({
      where: { idempotencyKey: command.idempotencyKey! },
      include: { eventType: { select: { slug: true } } },
    });
    const same =
      row.eventType.slug === command.slug &&
      row.start.getTime() === command.start.getTime() &&
      row.inviteeEmail === command.invitee.email;
    if (!same) throw new AppError('idempotency_mismatch', 'This idempotency key was used for a different booking');
    return this.byId(row.id);
  }

  private async byId(id: string): Promise<BookingView & { manageToken: string }> {
    const row = await this.db.booking.findUnique({ where: { id }, include: { eventType: true, host: true } });
    if (!row) throw new AppError('not_found', 'There is no such booking');
    return toView(row);
  }

  private event(
    type: DomainEvent['type'],
    bookingId: string,
    hostId: string,
    start: number,
    end: number,
    eventType: { slug: string; synthetic: boolean },
    now: number,
  ): DomainEvent {
    return {
      id: randomUUID(),
      type,
      version: 1,
      aggregateId: bookingId,
      occurredAt: new Date(now).toISOString(),
      payload: {
        bookingId,
        eventTypeSlug: eventType.slug,
        hostId,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        synthetic: eventType.synthetic,
      },
    };
  }
}

function toView(
  row: Booking & { eventType: { slug: string; title: string }; host: { id: string; name: string } },
): BookingView & { manageToken: string } {
  return {
    id: row.id,
    status: row.status,
    slug: row.eventType.slug,
    title: row.eventType.title,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    host: { id: row.host.id, name: row.host.name },
    invitee: { name: row.inviteeName, timeZone: row.inviteeZone },
    manageToken: row.manageToken,
  };
}
