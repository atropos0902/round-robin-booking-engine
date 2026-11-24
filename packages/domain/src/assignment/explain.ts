import { type Decision, type SkipReason, TURN } from './assign';

const REASONS: Record<SkipReason, string> = {
  outside_hours: 'was outside working hours',
  busy: 'already had something at that time',
  daily_cap: 'had reached the daily limit',
  lost_race: 'was booked through another link at the same moment',
  lower_priority: 'was free, but has a lower priority',
  inactive: 'is switched off in this rotation',
};

const turns = (micro: number) => (micro / TURN).toFixed(2);

/** The answer to "why did this meeting go to them?", one sentence per host. */
export function explain(decision: Decision, name: (hostId: string) => string): string[] {
  const chosen = decision.candidates.find((c) => c.hostId === decision.hostId)!;
  const others = decision.candidates.filter((c) => c.hostId !== decision.hostId);
  const lines = [
    others.length === 0
      ? `${name(chosen.hostId)} took the meeting. Nobody else with that priority was free.`
      : `${name(chosen.hostId)} took the meeting. Their turn was due first, with a balance of ${turns(
          chosen.balanceBefore + chosen.share,
        )} turns at weight ${chosen.weight}.`,
  ];
  for (const other of others) {
    lines.push(
      `${name(other.hostId)} was free too, with a balance of ${turns(other.balanceBefore + other.share)} turns at weight ${other.weight}.`,
    );
  }
  for (const skipped of decision.skipped) lines.push(`${name(skipped.hostId)} ${REASONS[skipped.reason]}.`);
  return lines;
}
