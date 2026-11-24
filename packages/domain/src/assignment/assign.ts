import type { Unavailable } from '../availability/slots';

/** Balances are whole numbers, a millionth of a turn each, so adding them up never drifts. */
export const TURN = 1_000_000;

export interface Member {
  readonly hostId: string;
  readonly weight: number;
  /** A higher number is asked first. */
  readonly priority: number;
  /** Turns earned minus turns taken. Positive means the rotation owes this host. */
  readonly balance: number;
  readonly lastAssignedAt: number | null;
}

export type SkipReason = Unavailable | 'lost_race' | 'lower_priority' | 'inactive';

export interface Candidate {
  readonly hostId: string;
  readonly weight: number;
  readonly share: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

export interface Decision {
  readonly hostId: string;
  readonly priority: number;
  readonly candidates: readonly Candidate[];
  readonly skipped: readonly { readonly hostId: string; readonly reason: SkipReason }[];
}

const byId = (a: { hostId: string }, b: { hostId: string }) => (a.hostId < b.hostId ? -1 : a.hostId > b.hostId ? 1 : 0);

/** Splits one turn by weight. The parts add up to exactly TURN. */
export function shares(members: readonly { hostId: string; weight: number }[]): Map<string, number> {
  const total = members.reduce((sum, m) => sum + m.weight, 0);
  const parts = members.map((m) => ({
    hostId: m.hostId,
    share: Math.floor((TURN * m.weight) / total),
    rest: (TURN * m.weight) % total,
  }));
  let left = TURN - parts.reduce((sum, p) => sum + p.share, 0);
  for (const part of [...parts].sort((a, b) => b.rest - a.rest || byId(a, b))) {
    if (left-- <= 0) break;
    part.share += 1;
  }
  return new Map(parts.map((p) => [p.hostId, p.share]));
}

/**
 * Picks the host for one meeting.
 *
 * Only hosts who are free earn a share of the turn, so someone back from leave does not come back
 * to a pile of owed meetings. Among hosts with a positive balance the turn goes to the one whose
 * next whole turn falls due first. With a stable group that keeps everybody less than one turn
 * away from their exact share, which is the quota method of Balinski and Young.
 */
export function assign(
  members: readonly Member[],
  availability: ReadonlyMap<string, SkipReason | null>,
): Decision | null {
  const free = members.filter((m) => availability.get(m.hostId) === null);
  if (free.length === 0) return null;

  const priority = Math.max(...free.map((m) => m.priority));
  const tier = free.filter((m) => m.priority === priority).sort(byId);
  const share = shares(tier);
  const earned = tier.map((m) => ({ ...m, balance: m.balance + share.get(m.hostId)! }));

  const owed = earned.filter((m) => m.balance > 0);
  const [chosen] = (owed.length > 0 ? owed : earned).sort(
    (a, b) =>
      (TURN - a.balance) * b.weight - (TURN - b.balance) * a.weight ||
      b.balance - a.balance ||
      (a.lastAssignedAt ?? -Infinity) - (b.lastAssignedAt ?? -Infinity) ||
      byId(a, b),
  );

  return {
    hostId: chosen!.hostId,
    priority,
    candidates: tier.map((m) => ({
      hostId: m.hostId,
      weight: m.weight,
      share: share.get(m.hostId)!,
      balanceBefore: m.balance,
      balanceAfter: m.balance + share.get(m.hostId)! - (m.hostId === chosen!.hostId ? TURN : 0),
    })),
    skipped: [
      ...members
        .filter((m) => availability.get(m.hostId) !== null)
        .map((m) => ({ hostId: m.hostId, reason: availability.get(m.hostId) ?? ('inactive' as const) })),
      ...free.filter((m) => m.priority < priority).map((m) => ({ hostId: m.hostId, reason: 'lower_priority' as const })),
    ],
  };
}

/** Balance changes that put the rotation back to where it was before the decision. */
export function undo(decision: Decision): Map<string, number> {
  return new Map(
    decision.candidates.map((c) => [c.hostId, (c.hostId === decision.hostId ? TURN : 0) - c.share]),
  );
}
