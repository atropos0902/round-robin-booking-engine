import { type Db, type DomainEvent, logger } from '@rr/core';
import type { Consumer } from './consumer';
import { ics } from './ics';

/**
 * Makes the host's calendar match the booking as it is now, whatever the event says. Events can
 * arrive out of order, and a late "confirmed" must not bring a cancelled meeting back.
 */
export class CalendarSync implements Consumer {
  readonly name = 'calendar-sync';

  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async handle(event: DomainEvent, db: Db): Promise<void> {
    const load = () =>
      db.booking.findUnique({ where: { id: event.payload.bookingId }, include: { host: true, eventType: true } });

    // The booking can change while the request is on its way, so look again afterwards.
    for (let pass = 0; pass < 3; pass++) {
      const booking = await load();
      if (!booking?.host.calendarUrl) return;
      const url = `${booking.host.calendarUrl.replace(/\/$/, '')}/${booking.id}.ics`;

      if (booking.status === 'CONFIRMED') {
        const body = ics({
          uid: booking.id,
          title: `${booking.eventType.title} with ${booking.inviteeName}`,
          start: booking.start,
          end: booking.end,
          description: `Booked by ${booking.inviteeName} (${booking.inviteeZone})`,
          stamp: booking.createdAt,
        });
        await this.send('PUT', url, body);
      } else {
        await this.send('DELETE', url);
      }
      if ((await load())?.status === booking.status) return;
      logger.info('booking changed during the sync, syncing again');
    }
    throw new Error('the booking keeps changing, giving up for now');
  }

  private async send(method: 'PUT' | 'DELETE', url: string, body?: string): Promise<void> {
    const { CALDAV_USER, CALDAV_PASSWORD } = process.env;
    const response = await this.fetcher(url, {
      method,
      body,
      signal: AbortSignal.timeout(8000),
      headers: {
        ...(body ? { 'content-type': 'text/calendar; charset=utf-8' } : {}),
        ...(CALDAV_USER
          ? { authorization: `Basic ${Buffer.from(`${CALDAV_USER}:${CALDAV_PASSWORD}`).toString('base64')}` }
          : {}),
      },
    });
    const gone = method === 'DELETE' && (response.status === 404 || response.status === 410);
    if (!response.ok && !gone) throw new Error(`calendar answered ${response.status} to ${method}`);
  }
}
