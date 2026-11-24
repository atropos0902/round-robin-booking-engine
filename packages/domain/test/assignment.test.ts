import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Member, type SkipReason, TURN, assign, explain, shares, undo } from '../src';

const weights = fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 12 });

const build = (ws: number[], priority = 0): Member[] =>
  ws.map((weight, i) => ({ hostId: `h${String(i).padStart(2, '0')}`, weight, priority, balance: 0, lastAssignedAt: null }));

const everyone = (ms: Member[]) => new Map<string, SkipReason | null>(ms.map((m) => [m.hostId, null]));

function play(members: Member[], rounds: number, who: (round: number) => Map<string, SkipReason | null>) {
  let state = members;
  const counts = new Map(members.map((m) => [m.hostId, 0]));
  const history: Member[][] = [];
  for (let r = 0; r < rounds; r++) {
    const d = assign(state, who(r));
    if (!d) continue;
    counts.set(d.hostId, counts.get(d.hostId)! + 1);
    const after = new Map(d.candidates.map((c) => [c.hostId, c.balanceAfter]));
    state = state.map((m) => ({
      ...m,
      balance: after.get(m.hostId) ?? m.balance,
      lastAssignedAt: m.hostId === d.hostId ? r : m.lastAssignedAt,
    }));
    history.push(state);
  }
  return { state, counts, history };
}

describe('assignment', () => {
  it('keeps every host less than one turn from their exact share, at every step', () => {
    fc.assert(
      fc.property(weights, fc.integer({ min: 1, max: 400 }), (ws, rounds) => {
        const total = ws.reduce((a, b) => a + b, 0);
        const members = build(ws);
        const counts = new Map(members.map((m) => [m.hostId, 0]));
        let state = members;
        for (let n = 1; n <= rounds; n++) {
          const d = assign(state, everyone(state))!;
          counts.set(d.hostId, counts.get(d.hostId)! + 1);
          const after = new Map(d.candidates.map((c) => [c.hostId, c.balanceAfter]));
          state = state.map((m) => ({ ...m, balance: after.get(m.hostId)! }));
          for (const m of members) {
            const exact = (n * m.weight) / total;
            // The allowance is the rounding of a share to a millionth of a turn.
            expect(Math.abs(counts.get(m.hostId)! - exact)).toBeLessThan(1 + n * 1e-6);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('gives a 3:2:1 group exactly 3, 2 and 1 turns out of six', () => {
    const { counts } = play(build([3, 2, 1]), 60, () => everyone(build([3, 2, 1])));
    expect([...counts.values()]).toEqual([30, 20, 10]);
  });

  it('never creates or loses a turn when people come and go', () => {
    fc.assert(
      fc.property(weights, fc.array(fc.nat({ max: 4095 }), { minLength: 1, maxLength: 200 }), (ws, masks) => {
        const members = build(ws);
        const { history } = play(members, masks.length, (r) =>
          new Map(members.map((m, i) => [m.hostId, (masks[r]! >> i) & 1 ? null : ('busy' as const)])),
        );
        for (const state of history) expect(state.reduce((s, m) => s + m.balance, 0)).toBe(0);
      }),
    );
  });

  it('does not bury a host who was away under the meetings they missed', () => {
    const members = build([1, 1, 1]);
    const away = new Map<string, SkipReason | null>([['h00', 'outside_hours'], ['h01', null], ['h02', null]]);
    const { state } = play(members, 300, () => away);
    const { counts } = play(state, 30, () => everyone(members));
    for (const n of counts.values()) expect(Math.abs(n - 10)).toBeLessThanOrEqual(1);
  });

  it('asks the highest priority first and leaves the others alone', () => {
    fc.assert(
      fc.property(weights, weights, fc.integer({ min: 0, max: 4095 }), (high, low, mask) => {
        const members = [...build(high, 2), ...build(low, 1).map((m) => ({ ...m, hostId: `low-${m.hostId}` }))];
        const availability = new Map<string, SkipReason | null>(
          members.map((m, i) => [m.hostId, m.priority === 1 || (mask >> i) & 1 ? null : 'busy']),
        );
        const d = assign(members, availability)!;
        const highFree = members.some((m) => m.priority === 2 && availability.get(m.hostId) === null);
        expect(d.priority).toBe(highFree ? 2 : 1);
        expect(d.candidates.every((c) => members.find((m) => m.hostId === c.hostId)!.priority === d.priority)).toBe(true);
      }),
    );
  });

  it('only ever picks a free host, and reports every member exactly once', () => {
    fc.assert(
      fc.property(weights, fc.nat({ max: 4095 }), (ws, mask) => {
        const members = build(ws);
        const availability = new Map<string, SkipReason | null>(members.map((m, i) => [m.hostId, (mask >> i) & 1 ? null : 'busy']));
        const d = assign(members, availability);
        if (!d) {
          expect([...availability.values()].every((v) => v !== null)).toBe(true);
          return;
        }
        expect(availability.get(d.hostId)).toBeNull();
        expect([...d.candidates, ...d.skipped].map((x) => x.hostId).sort()).toEqual(members.map((m) => m.hostId).sort());
      }),
    );
  });

  it('gives the turn back exactly when a meeting is cancelled', () => {
    fc.assert(
      fc.property(weights, fc.integer({ min: 0, max: 40 }), (ws, warmup) => {
        const { state } = play(build(ws), warmup, () => everyone(build(ws)));
        const d = assign(state, everyone(state))!;
        const back = undo(d);
        for (const c of d.candidates) expect(c.balanceAfter + back.get(c.hostId)!).toBe(c.balanceBefore);
      }),
    );
  });

  it('splits one turn without rounding loss', () => {
    fc.assert(
      fc.property(weights, (ws) => {
        expect([...shares(build(ws)).values()].reduce((a, b) => a + b, 0)).toBe(TURN);
      }),
    );
  });

  it('does not depend on the order the members arrive in', () => {
    fc.assert(
      fc.property(weights, fc.nat(), (ws, seed) => {
        const { state } = play(build(ws), seed % 30, () => everyone(build(ws)));
        const shuffled = [...state].sort((a, b) => ((a.hostId.charCodeAt(2) * 7919 + seed) % 13) - ((b.hostId.charCodeAt(2) * 7919 + seed) % 13));
        expect(assign(shuffled, everyone(state))!.hostId).toBe(assign(state, everyone(state))!.hostId);
      }),
    );
  });

  it('explains itself in one line per member', () => {
    const members = [...build([2, 1]), { hostId: 'zz', weight: 1, priority: -1, balance: 0, lastAssignedAt: null }];
    const d = assign(members, everyone(members))!;
    expect(explain(d, (id) => id)).toEqual([
      'h00 took the meeting. Their turn was due first, with a balance of 0.67 turns at weight 2.',
      'h01 was free too, with a balance of 0.33 turns at weight 1.',
      'zz was free, but has a lower priority.',
    ]);
  });
});
