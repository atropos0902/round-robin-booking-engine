import { type EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { type SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { DomainEvent, EventPublisher } from '@rr/core';

export const SOURCE = 'rr.booking';

export class EventBridgePublisher implements EventPublisher {
  constructor(
    private readonly client: EventBridgeClient,
    private readonly busName: string,
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<string[]> {
    const result = await this.client.send(
      new PutEventsCommand({
        Entries: events.map((event) => ({
          EventBusName: this.busName,
          Source: SOURCE,
          DetailType: event.type,
          Detail: JSON.stringify(event),
        })),
      }),
    );
    // A 200 can still hold rejected entries, in the same order they were sent.
    return events.filter((_, i) => result.Entries?.[i]?.EventId === undefined).map((e) => e.id);
  }
}

/** Stands in for EventBridge on a laptop: the same envelope, written to every queue. */
export class FanOutPublisher implements EventPublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrls: readonly string[],
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<string[]> {
    const failed: string[] = [];
    for (const event of events) {
      const body = JSON.stringify({ source: SOURCE, 'detail-type': event.type, detail: event });
      const sends = this.queueUrls.map((QueueUrl) => this.client.send(new SendMessageCommand({ QueueUrl, MessageBody: body })));
      const results = await Promise.allSettled(sends);
      if (results.some((r) => r.status === 'rejected')) failed.push(event.id);
    }
    return failed;
  }
}
