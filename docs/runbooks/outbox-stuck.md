# Outbox stuck

**Alarm:** `outbox-stuck`, or the API health check from Checkly. Bookings still work. Calendars, mails and webhooks fall behind.

1. `npm run outbox:status`. The oldest age tells how far behind it is.
2. Nothing waiting, alarm still on: the relay does not run. Look at the last runs of the `relay` function and at the rule that starts it.
3. Rows waiting, tried more than once: the bus refuses them. Search Elastic for `event bus refused the batch`.
4. Rows waiting, never tried: the relay cannot reach the database. Check the secret and the connection limit.

Do not mark rows as published by hand. They are sent as soon as the cause is gone, and consumers drop what they have already seen.

**Done when** the oldest age is back under a minute.
