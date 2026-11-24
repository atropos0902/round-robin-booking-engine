import { type Interval, contains, overlaps } from './intervals';
import { DAY, MINUTE, localDay } from './time-zone';
import { type Schedule, workingIntervals } from './working-hours';

export interface EventRules {
  readonly durationMinutes: number;
  readonly slotStepMinutes: number;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly minimumNoticeMinutes: number;
  readonly horizonDays: number;
  /** Counts every confirmed meeting the host has that local day, whichever link it came from. */
  readonly dailyCapPerHost: number | null;
}

export interface HostSnapshot {
  readonly hostId: string;
  readonly schedule: Schedule;
  /** Confirmed meetings with their buffers, plus blocks from the host's own calendar. */
  readonly busy: readonly Interval[];
  /** Start times of confirmed meetings, used only for the daily cap. */
  readonly meetingStarts: readonly number[];
}

export type Unavailable = 'outside_hours' | 'busy' | 'daily_cap';
export type SlotProblem = 'off_grid' | 'too_soon' | 'too_far';

export function meeting(rules: EventRules, start: number): Interval {
  return { from: start, to: start + rules.durationMinutes * MINUTE };
}

/** The time a meeting takes out of the host's day, buffers included. */
export function blockedRange(rules: EventRules, start: number): Interval {
  const { from, to } = meeting(rules, start);
  return { from: from - rules.bufferBeforeMinutes * MINUTE, to: to + rules.bufferAfterMinutes * MINUTE };
}

/** Rules that concern the slot and no particular host. */
export function slotProblem(rules: EventRules, start: number, now: number): SlotProblem | null {
  if (start % (rules.slotStepMinutes * MINUTE) !== 0) return 'off_grid';
  if (start < now + rules.minimumNoticeMinutes * MINUTE) return 'too_soon';
  if (start > now + rules.horizonDays * DAY) return 'too_far';
  return null;
}

export class HostCalendar {
  private readonly working: Interval[];
  private readonly meetingsPerDay = new Map<number, number>();

  constructor(
    private readonly host: HostSnapshot,
    range: Interval,
  ) {
    this.working = workingIntervals(host.schedule, range);
    for (const start of host.meetingStarts) {
      const day = localDay(host.schedule.timeZone, start);
      this.meetingsPerDay.set(day, (this.meetingsPerDay.get(day) ?? 0) + 1);
    }
  }

  get hostId(): string {
    return this.host.hostId;
  }

  /** Buffers may run past working hours, the meeting may not. */
  whyUnavailable(rules: EventRules, start: number): Unavailable | null {
    if (!contains(this.working, meeting(rules, start))) return 'outside_hours';
    const blocked = blockedRange(rules, start);
    if (this.host.busy.some((b) => overlaps(b, blocked))) return 'busy';
    if (rules.dailyCapPerHost !== null) {
      const day = localDay(this.host.schedule.timeZone, start);
      if ((this.meetingsPerDay.get(day) ?? 0) >= rules.dailyCapPerHost) return 'daily_cap';
    }
    return null;
  }
}

/** Padding around a start time that covers the meeting and the whole local day it falls on. */
export const CONTEXT = 2 * DAY;

export function availabilityAt(
  rules: EventRules,
  hosts: readonly HostSnapshot[],
  start: number,
): Map<string, Unavailable | null> {
  const range = { from: start - CONTEXT, to: start + CONTEXT };
  return new Map(hosts.map((h) => [h.hostId, new HostCalendar(h, range).whyUnavailable(rules, start)]));
}

/** Start times inside `range` that at least one host can take. */
export function openSlots(
  rules: EventRules,
  hosts: readonly HostSnapshot[],
  range: Interval,
  now: number,
): number[] {
  const step = rules.slotStepMinutes * MINUTE;
  const from = Math.max(range.from, now + rules.minimumNoticeMinutes * MINUTE);
  const to = Math.min(range.to, now + rules.horizonDays * DAY + 1);
  const padded = { from: from - CONTEXT, to: to + CONTEXT };
  if (from >= to) return [];
  const calendars = hosts.map((h) => new HostCalendar(h, padded));
  const out: number[] = [];
  for (let start = Math.ceil(from / step) * step; start < to; start += step) {
    if (calendars.some((c) => c.whyUnavailable(rules, start) === null)) out.push(start);
  }
  return out;
}
