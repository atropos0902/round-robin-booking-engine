# Dead letters

**Alarm:** `<consumer>-dead-letters`. A message failed five times.

1. Take one message from the queue in the console, without deleting it. The booking id is in `detail.payload.bookingId`.
2. Search Elastic for `labels.booking_id: "<id>"`. The line `message failed` has the error. Sentry has the same error under the tag `booking_id`.
3. Fix the cause. A webhook endpoint that is gone for good: set its subscription to inactive.
4. `npm run replay-dlq -- <consumer> rr-<stage>-`

Replaying is safe. Whatever already succeeded is dropped as a repeat.

A body that is not valid never succeeds. If it came from a deploy that changed an event shape, roll that deploy back before replaying.

**Done when** the queue is empty and has stayed empty for ten minutes.
