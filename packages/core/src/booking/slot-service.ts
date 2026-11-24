import { dayNumber, isoDate, openSlots, startOfLocalDate } from '@rr/domain';
import type { Db } from '../db';
import { findEventType, loadRotation } from './rotation';

export class SlotService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async links(): Promise<{ slug: string; title: string; durationMinutes: number; hosts: number }[]> {
    const rows = await this.db.eventType.findMany({
      where: { synthetic: false },
      orderBy: { title: 'asc' },
      include: { _count: { select: { members: { where: { active: true } } } } },
    });
    return rows.map((r) => ({ slug: r.slug, title: r.title, durationMinutes: r.durationMinutes, hosts: r._count.members }));
  }

  async open(slug: string, from: Date, to: Date): Promise<{ title: string; durationMinutes: number; slots: string[] }> {
    const eventType = await findEventType(this.db, slug);
    const range = { from: from.getTime(), to: to.getTime() };
    const rotation = await loadRotation(this.db, eventType, range);
    const slots = openSlots(rotation.rules, rotation.hosts, range, this.now());
    return {
      title: eventType.title,
      durationMinutes: eventType.durationMinutes,
      slots: slots.map((s) => new Date(s).toISOString()),
    };
  }

  /** Seven days on the customer's calendar. Days are cut in the customer's zone, not the server's. */
  async week(slug: string, startDate: string, timeZone: string) {
    const first = dayNumber(startDate);
    const edges = Array.from({ length: 8 }, (_, i) => startOfLocalDate(timeZone, isoDate(first + i)));
    const { slots, ...rest } = await this.open(slug, new Date(edges[0]!), new Date(edges[7]!));
    const days = edges.slice(0, 7).map((from, i) => ({
      date: isoDate(first + i),
      slots: slots.filter((s) => Date.parse(s) >= from && Date.parse(s) < edges[i + 1]!),
    }));
    return { ...rest, days };
  }
}

