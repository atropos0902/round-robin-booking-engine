export function today(timeZone: string): string {
  // en-CA writes dates as year-month-day.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function dayLabel(date: string): { weekday: string; day: string } {
  const at = new Date(`${date}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(at);
  return { weekday: part({ weekday: 'short' }), day: part({ day: 'numeric', month: 'short' }) };
}

export function clock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(instant));
}

export function fullTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(instant));
}

/** Browsers disagree on names (Katmandu or Kathmandu), so the one in use is always in the list. */
export function zones(current: string): string[] {
  return [...new Set([current, 'UTC', ...Intl.supportedValuesOf('timeZone')])].sort();
}
