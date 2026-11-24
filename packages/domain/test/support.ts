import fc from 'fast-check';
import { DAY, MINUTE, type EventRules, type HostSnapshot, offsetSegments } from '../src';

// Lord Howe shifts by 30 minutes, Kathmandu sits on :45, Santiago changes at midnight and
// Casablanca changes around Ramadan instead of by season.
export const ZONES = [
  'Pacific/Auckland',
  'Australia/Lord_Howe',
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Europe/London',
  'Africa/Casablanca',
  'Atlantic/Azores',
  'America/Santiago',
  'America/New_York',
  'America/St_Johns',
  'America/Los_Angeles',
  'Pacific/Kiritimati',
];

/** Any Monday will do, the tests look for clock changes from here. */
export const BASE = Math.ceil(Date.now() / (7 * DAY)) * 7 * DAY + 4 * DAY;

export function clockChanges(zone: string, from = BASE, days = 400): { at: number; by: number }[] {
  const segments = offsetSegments(zone, from, from + days * DAY);
  return segments.slice(1).map((s, i) => ({ at: s.from, by: s.offset - segments[i]!.offset }));
}

export interface WallTime {
  date: string;
  weekday: number;
  minute: number;
}

/** Reads the wall clock through Intl only, so it shares no code with the engine. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function wallTime(zone: string, instant: number): WallTime {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
    formatters.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!) + 1,
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

export function worksAt(host: HostSnapshot, instant: number): boolean {
  const w = wallTime(host.schedule.timeZone, instant);
  const windows = host.schedule.overrides[w.date] ?? host.schedule.weekly.filter((x) => x.weekday === w.weekday);
  return windows.some((x) => x.startMinute <= w.minute && w.minute < x.endMinute);
}

const window = fc
  .tuple(fc.integer({ min: 0, max: 95 }), fc.integer({ min: 1, max: 96 }))
  .map(([a, b]) => ({ startMinute: Math.min(a, b) * 15, endMinute: Math.max(a, b) * 15 }))
  .filter((w) => w.startMinute < w.endMinute);

export const rules: fc.Arbitrary<EventRules> = fc.record({
  durationMinutes: fc.constantFrom(15, 20, 30, 45, 60, 90),
  slotStepMinutes: fc.constantFrom(5, 15, 30, 60),
  bufferBeforeMinutes: fc.constantFrom(0, 5, 10, 15),
  bufferAfterMinutes: fc.constantFrom(0, 5, 10, 15),
  minimumNoticeMinutes: fc.constantFrom(0, 60, 240),
  horizonDays: fc.constantFrom(30, 60),
  dailyCapPerHost: fc.option(fc.integer({ min: 1, max: 5 }), { nil: null }),
});

/** Schedules whose interesting days sit around a clock change of the host's own zone. */
export const hostAround: fc.Arbitrary<{ zone: string; anchor: number }> = fc
  .tuple(fc.constantFrom(...ZONES), fc.nat(), fc.integer({ min: -3 * 24, max: 3 * 24 }))
  .map(([zone, pick, hours]) => {
    const changes = clockChanges(zone);
    const at = changes.length ? changes[pick % changes.length]!.at : BASE + 10 * DAY;
    return { zone, anchor: Math.floor((at + hours * 60 * MINUTE) / (60 * MINUTE)) * 60 * MINUTE };
  });

export const weekly = fc.array(
  fc.tuple(fc.integer({ min: 1, max: 7 }), window).map(([weekday, w]) => ({ weekday, ...w })),
  { minLength: 1, maxLength: 14 },
);

export const dayWindows = fc.array(window, { maxLength: 2 });
