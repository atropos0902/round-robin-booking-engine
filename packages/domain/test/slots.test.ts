import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DAY, HostCalendar, type HostSnapshot, MINUTE, availabilityAt, openSlots, slotProblem } from '../src';
import { hostAround, rules, wallTime, weekly, worksAt } from './support';

const busyAround = (anchor: number) =>
  fc.array(
    fc
      .tuple(fc.integer({ min: -36, max: 36 }), fc.constantFrom(15, 30, 60, 120))
      .map(([h, m]) => ({ from: anchor + h * 60 * MINUTE, to: anchor + h * 60 * MINUTE + m * MINUTE })),
    { maxLength: 8 },
  );

const team = fc
  .tuple(hostAround, fc.integer({ min: 1, max: 5 }))
  .chain(([first, size]) =>
    fc
      .array(fc.tuple(hostAround, weekly, busyAround(first.anchor)), { minLength: size, maxLength: size })
      .map((hosts) => ({
        anchor: first.anchor,
        hosts: hosts.map(
          ([h, week, busy], i): HostSnapshot => ({
            hostId: `host-${i}`,
            schedule: { timeZone: i === 0 ? first.zone : h.zone, weekly: week, overrides: {} },
            busy,
            meetingStarts: busy.map((b) => b.from),
          }),
        ),
      })),
  );

describe('open slots', () => {
  it('never put a meeting outside hours, on top of something else, or past the daily cap', () => {
    let seen = 0;
    fc.assert(
      fc.property(team, rules, ({ anchor, hosts }, r) => {
        const now = anchor - 2 * DAY;
        for (const start of openSlots(r, hosts, { from: anchor - DAY, to: anchor + DAY }, now)) {
          expect(slotProblem(r, start, now)).toBeNull();
          const free = hosts.filter((h) => availabilityAt(r, hosts, start).get(h.hostId) === null);
          expect(free.length).toBeGreaterThan(0);
          for (const h of free) {
            seen++;
            for (let t = start; t < start + r.durationMinutes * MINUTE; t += 5 * MINUTE) expect(worksAt(h, t)).toBe(true);
            const from = start - r.bufferBeforeMinutes * MINUTE;
            const to = start + (r.durationMinutes + r.bufferAfterMinutes) * MINUTE;
            for (const b of h.busy) expect(b.to <= from || to <= b.from).toBe(true);
            if (r.dailyCapPerHost !== null) {
              const day = wallTime(h.schedule.timeZone, start).date;
              const held = h.meetingStarts.filter((s) => wallTime(h.schedule.timeZone, s).date === day).length;
              expect(held).toBeLessThan(r.dailyCapPerHost);
            }
          }
        }
      }),
      { numRuns: 150 },
    );
    expect(seen).toBeGreaterThan(500);
  });

  it('miss nothing: a grid time that is not offered has a reason for every host', () => {
    fc.assert(
      fc.property(team, rules, ({ anchor, hosts }, r) => {
        const now = anchor - 2 * DAY;
        const offered = new Set(openSlots(r, hosts, { from: anchor - DAY / 2, to: anchor + DAY / 2 }, now));
        const step = r.slotStepMinutes * MINUTE;
        for (let t = Math.ceil((anchor - DAY / 2) / step) * step; t < anchor + DAY / 2; t += step) {
          if (offered.has(t) || slotProblem(r, t, now)) continue;
          for (const reason of availabilityAt(r, hosts, t).values()) expect(reason).not.toBeNull();
        }
      }),
      { numRuns: 60 },
    );
  });

  it('let buffers run past working hours but not the meeting', () => {
    const start = Math.ceil(Date.now() / DAY) * DAY + 17 * 60 * MINUTE - 30 * MINUTE;
    const host: HostSnapshot = {
      hostId: 'h',
      schedule: {
        timeZone: 'UTC',
        weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })),
        overrides: {},
      },
      busy: [],
      meetingStarts: [],
    };
    const r = {
      durationMinutes: 30,
      slotStepMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 30,
      minimumNoticeMinutes: 0,
      horizonDays: 30,
      dailyCapPerHost: null,
    };
    const calendar = new HostCalendar(host, { from: start - DAY, to: start + DAY });
    expect(calendar.whyUnavailable(r, start)).toBeNull();
    expect(calendar.whyUnavailable({ ...r, durationMinutes: 31 }, start)).toBe('outside_hours');
  });
});
