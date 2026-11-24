import { isTimeZone } from '@rr/domain';
import { z } from 'zod';

const instant = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const timeZone = z.string().max(64).refine(isTimeZone, 'Unknown time zone');
const slug = z.string().regex(/^[a-z0-9-]{1,64}$/);

export const slotsQuery = z
  .object({ slug, from: instant, to: instant })
  .refine((q) => q.from < q.to, 'from must be before to')
  .refine((q) => q.to.getTime() - q.from.getTime() <= 31 * 86_400_000, 'The range can be 31 days at most');

export const weekQuery = z.object({ slug, startDate: z.iso.date(), timeZone });

export const bookCommand = z.object({
  slug,
  start: instant,
  invitee: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    timeZone,
  }),
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type BookCommand = z.output<typeof bookCommand>;

export const busyCommand = z.object({
  source: z.string().min(1).max(64),
  from: instant,
  to: instant,
  blocks: z.array(z.object({ from: instant, to: instant }).refine((b) => b.from < b.to, 'from must be before to')).max(2000),
});

/**
 * Event shapes. These leave the process and sit in queues across deploys, so a field is only ever
 * added as optional. Anything else is a new version.
 */
const bookingPayload = z.object({
  bookingId: z.uuid(),
  eventTypeSlug: z.string(),
  hostId: z.uuid(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  synthetic: z.boolean(),
});

export const domainEvent = z.object({
  id: z.uuid(),
  type: z.enum(['booking.confirmed', 'booking.cancelled']),
  version: z.literal(1),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: bookingPayload,
});
export type DomainEvent = z.infer<typeof domainEvent>;
