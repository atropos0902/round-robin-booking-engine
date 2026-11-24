/** Half-open [from, to), epoch milliseconds. */
export interface Interval {
  readonly from: number;
  readonly to: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.from < b.to && b.from < a.to;
}

/** Sorts, drops empty intervals and joins the ones that touch. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.from < i.to).sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  for (const current of sorted) {
    const last = out[out.length - 1];
    if (last && current.from <= last.to) last.to = Math.max(last.to, current.to);
    else out.push({ from: current.from, to: current.to });
  }
  return out;
}

/** `intervals` must be normalized, otherwise two touching pieces look like a gap. */
export function contains(intervals: readonly Interval[], inner: Interval): boolean {
  return intervals.some((i) => i.from <= inner.from && inner.to <= i.to);
}
