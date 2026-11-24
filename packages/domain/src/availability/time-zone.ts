import { Temporal } from '@js-temporal/polyfill';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** A stretch of time during which a zone keeps one UTC offset. */
export interface OffsetSegment {
  readonly from: number;
  readonly to: number;
  readonly offset: number;
}

// Looking up the next clock change is the slow part, so segments are remembered per zone.
const known = new Map<string, OffsetSegment[]>();

function segmentAt(zone: string, instant: number): OffsetSegment {
  const cached = known.get(zone) ?? [];
  const hit = cached.find((s) => s.from <= instant && instant < s.to);
  if (hit) return hit;

  const zoned = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(zone);
  const segment: OffsetSegment = {
    from: zoned.getTimeZoneTransition('previous')?.epochMilliseconds ?? -Infinity,
    to: zoned.getTimeZoneTransition('next')?.epochMilliseconds ?? Infinity,
    offset: zoned.offsetNanoseconds / 1_000_000,
  };
  // 'previous' is strictly before the instant, so an instant that is itself a clock change
  // gets the segment before it. Start from the instant in that case.
  const startsHere =
    segment.from !== -Infinity &&
    Temporal.Instant.fromEpochMilliseconds(instant - 1).toZonedDateTimeISO(zone).offsetNanoseconds !==
      zoned.offsetNanoseconds;
  const result = startsHere ? { ...segment, from: instant } : segment;
  known.set(zone, [...cached, result]);
  return result;
}

export function offsetSegments(zone: string, from: number, to: number): OffsetSegment[] {
  const out: OffsetSegment[] = [];
  let cursor = from;
  while (cursor < to) {
    const segment = segmentAt(zone, cursor);
    const end = Math.min(segment.to, to);
    out.push({ from: cursor, to: end, offset: segment.offset });
    cursor = end;
  }
  return out;
}

export function offsetAt(zone: string, instant: number): number {
  return segmentAt(zone, instant).offset;
}

/** Days since the epoch on the wall calendar of `zone`. */
export function localDay(zone: string, instant: number): number {
  return Math.floor((instant + offsetAt(zone, instant)) / DAY);
}

export function isoDate(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
}

/** 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/** First instant that falls on `date` in `zone`. Not always 00:00, some zones skip midnight. */
export function startOfLocalDate(zone: string, date: string): number {
  return Temporal.PlainDate.from(date).toZonedDateTime(zone).epochMilliseconds;
}

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
