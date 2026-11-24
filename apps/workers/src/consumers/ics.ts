export interface CalendarEntry {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description: string;
  stamp: Date;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** RFC 5545 allows 75 bytes per line. Cutting by character keeps multi-byte names intact. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char) > 75) {
      out.push(current);
      current = ' ';
    }
    current += char;
  }
  return [...out, current].join('\r\n');
}

export function ics(entry: CalendarEntry): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//round-robin-booking-engine//EN',
      'BEGIN:VEVENT',
      `UID:${entry.uid}`,
      `DTSTAMP:${utc(entry.stamp)}`,
      `DTSTART:${utc(entry.start)}`,
      `DTEND:${utc(entry.end)}`,
      `SUMMARY:${escape(entry.title)}`,
      `DESCRIPTION:${escape(entry.description)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}
