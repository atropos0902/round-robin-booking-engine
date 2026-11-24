import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { DAY, MINUTE, type HostSnapshot, isoDate, localDay, startOfLocalDate, workingIntervals } from '../src';
import { clockChanges, dayWindows, hostAround, wallTime, weekly, worksAt, ZONES } from './support';

const everyDay = (startMinute: number, endMinute: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute, endMinute }));

describe('working hours', () => {
  it('agree with the wall clock at every minute around a clock change', () => {
    fc.assert(
      fc.property(hostAround, weekly, dayWindows, ({ zone, anchor }, week, override) => {
        const host: HostSnapshot = {
          hostId: 'h',
          schedule: { timeZone: zone, weekly: week, overrides: { [isoDate(localDay(zone, anchor))]: override } },
          busy: [],
          meetingStarts: [],
        };
        const range = { from: anchor - 18 * 60 * MINUTE, to: anchor + 18 * 60 * MINUTE };
        const intervals = workingIntervals(host.schedule, range);
        for (let t = range.from; t < range.to; t += 5 * MINUTE) {
          expect(intervals.some((i) => i.from <= t && t < i.to)).toBe(worksAt(host, t));
        }
      }),
      { numRuns: 300 },
    );
  });

  it.each(ZONES)('keep a 9:00 start at 9:00 all year in %s', (timeZone) => {
    const changes = clockChanges(timeZone);
    const anchors = changes.length ? changes.map((c) => c.at) : [Date.now()];
    for (const at of anchors) {
      const schedule = { timeZone, weekly: everyDay(540, 1020), overrides: {} };
      for (const i of workingIntervals(schedule, { from: at - 5 * DAY, to: at + 5 * DAY }).slice(1, -1)) {
        expect(wallTime(timeZone, i.from).minute).toBe(540);
        expect(wallTime(timeZone, i.to).minute).toBe(1020);
      }
    }
  });

  it('shrink by the skipped hour and grow by the repeated one', () => {
    const timeZone = 'America/New_York';
    const schedule = { timeZone, weekly: everyDay(60, 240), overrides: {} };
    for (const change of clockChanges(timeZone)) {
      const date = wallTime(timeZone, change.at).date;
      const from = startOfLocalDate(timeZone, date);
      const worked = workingIntervals(schedule, { from, to: from + 20 * 60 * MINUTE }).reduce((s, i) => s + i.to - i.from, 0);
      expect(worked).toBe(180 * MINUTE - change.by);
    }
  });

  it('join windows that meet at midnight', () => {
    const schedule = {
      timeZone: 'Asia/Kathmandu',
      weekly: [
        { weekday: 1, startMinute: 1320, endMinute: 1440 },
        { weekday: 2, startMinute: 0, endMinute: 120 },
      ],
      overrides: {},
    };
    const from = Date.now();
    const full = workingIntervals(schedule, { from, to: from + 14 * DAY }).filter((i) => i.to - i.from === 240 * MINUTE);
    expect(full.length).toBeGreaterThanOrEqual(1);
  });

  it('give the same answer when the first instant ever asked about is a clock change', async () => {
    for (const zone of ['Europe/London', 'Australia/Lord_Howe', 'America/Santiago']) {
      for (const { at } of clockChanges(zone)) {
        for (const order of [[at, at - 1, at + 1], [at - 1, at, at + 1], [at + 1, at - 1, at]]) {
          // A fresh copy, because the zone cache of the usual one is already full.
          vi.resetModules();
          const fresh = await import('../src/availability/time-zone');
          for (const t of order) expect(fresh.isoDate(fresh.localDay(zone, t))).toBe(wallTime(zone, t).date);
          for (const t of order) {
            const local = new Date(t + fresh.offsetAt(zone, t));
            expect(local.getUTCHours() * 60 + local.getUTCMinutes()).toBe(wallTime(zone, t).minute);
          }
        }
      }
    }
  });
});
