import { DAY, MINUTE } from '@rr/domain';
import { type Db, db } from '../src';

export const NINE_TO_FIVE = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
export const ALWAYS = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 }));

/** Noon UTC a week from now, always on the grid and inside every horizon. */
export const NOON = (Math.floor(Date.now() / DAY) + 7) * DAY + 12 * 60 * MINUTE;

export async function reset(client: Db = db()): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE host, event_type, booking, outbox_event, inbox_entry, webhook_subscription RESTART IDENTITY CASCADE',
  );
}

let counter = 0;
export async function host(name: string, timeZone = 'UTC', hours = ALWAYS) {
  return db().host.create({
    data: { name, timeZone, email: `${name.toLowerCase()}-${counter++}@example.test`, hours: { create: hours } },
  });
}

interface MemberSpec {
  id: string;
  weight?: number;
  priority?: number;
}

export async function rotation(slug: string, members: MemberSpec[], overrides: Record<string, unknown> = {}) {
  return db().eventType.create({
    data: {
      slug,
      title: slug,
      durationMinutes: 30,
      slotStepMinutes: 30,
      ...overrides,
      members: { create: members.map(({ id, weight, priority }) => ({ hostId: id, weight, priority })) },
    },
  });
}

export const invitee = { name: 'Test Customer', email: 'customer@example.test', timeZone: 'Asia/Kolkata' };

export function at(minutesFromNoon: number): Date {
  return new Date(NOON + minutesFromNoon * MINUTE);
}
