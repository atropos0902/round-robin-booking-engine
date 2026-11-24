import { type Interval, normalize } from './intervals';
import { DAY, MINUTE, isoDate, isoWeekday, offsetSegments } from './time-zone';

/** Minutes since local midnight, end exclusive. 1440 means midnight at the end of the day. */
export interface DayWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface WeeklyWindow extends DayWindow {
  /** 1 is Monday, 7 is Sunday. */
  readonly weekday: number;
}

export interface Schedule {
  readonly timeZone: string;
  readonly weekly: readonly WeeklyWindow[];
  /** Replaces the weekly windows on that local date. An empty list is a day off. */
  readonly overrides: Readonly<Record<string, readonly DayWindow[]>>;
}

function windowsOn(schedule: Schedule, day: number): readonly DayWindow[] {
  return schedule.overrides[isoDate(day)] ?? schedule.weekly.filter((w) => w.weekday === isoWeekday(day));
}

/**
 * Every instant in `range` whose local wall time falls inside a window.
 *
 * The range is cut where the zone changes its offset. Inside a cut the offset is a constant, so a
 * skipped hour produces nothing and a repeated hour is produced twice, with no special cases.
 */
export function workingIntervals(schedule: Schedule, range: Interval): Interval[] {
  const out: Interval[] = [];
  for (const segment of offsetSegments(schedule.timeZone, range.from, range.to)) {
    const localFrom = segment.from + segment.offset;
    const localTo = segment.to + segment.offset;
    for (let day = Math.floor(localFrom / DAY); day * DAY < localTo; day++) {
      for (const window of windowsOn(schedule, day)) {
        const from = Math.max(day * DAY + window.startMinute * MINUTE, localFrom);
        const to = Math.min(day * DAY + window.endMinute * MINUTE, localTo);
        if (from < to) out.push({ from: from - segment.offset, to: to - segment.offset });
      }
    }
  }
  return normalize(out);
}
