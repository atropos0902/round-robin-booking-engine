import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { type Db, type DomainEvent, logger } from '@rr/core';
import type { Consumer } from './consumer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (mail: Mail) => Promise<void>;

export function sesMailer(from: string, client = new SESv2Client({})): SendMail {
  return async ({ to, subject, text }) => {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
      }),
    );
  };
}

export class EmailConsumer implements Consumer {
  readonly name = 'email';

  constructor(
    private readonly send: SendMail,
    private readonly appUrl: string,
  ) {}

  async handle(event: DomainEvent, db: Db): Promise<void> {
    const booking = await db.booking.findUnique({
      where: { id: event.payload.bookingId },
      include: { host: true, eventType: true },
    });
    if (!booking) return;
    const confirmed = event.type === 'booking.confirmed';
    if (confirmed && booking.status === 'CANCELLED') {
      logger.info('cancelled before the confirmation went out, not sending it');
      return;
    }
    const when = new Intl.DateTimeFormat('en', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: booking.inviteeZone,
    }).format(booking.start);
    await this.send({
      to: booking.inviteeEmail,
      subject: `${confirmed ? 'Confirmed' : 'Cancelled'}: ${booking.eventType.title}`,
      text: [
        `${booking.eventType.title} with ${booking.host.name}`,
        `${when} (${booking.inviteeZone})`,
        ...(confirmed ? ['', `Cancel: ${this.appUrl}/bookings/${booking.manageToken}`] : ['', 'This meeting is cancelled.']),
      ].join('\n'),
    });
  }
}
