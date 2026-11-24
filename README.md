# Round-robin booking engine

One scheduling link, many hosts. A customer picks a time, the engine decides who takes the meeting.

## What makes it hard

Hosts sit in different time zones, carry different weights and priorities, and can be in several rotations at once. Three things have to hold anyway.

**Nobody is booked outside their hours.** Hours are local wall time plus an IANA zone. They become UTC only for the stretch being asked about, cut at every clock change in that stretch. A 9:00 start stays at 9:00.

**Turns follow the weights.** With a stable group every host stays less than one turn from their exact share, at every step and for any weights. Someone back from leave is not owed the meetings they missed. [Why this method](docs/adr/turns.md).

**Nobody is booked twice.** A row lock puts bookings of one rotation in line. It cannot see a host who is also in another rotation, so a Postgres exclusion constraint has the last word. The request that loses tries the next host in a new transaction. [How the locks fit together](docs/adr/double-booking.md).

Every decision is saved with its reason. `GET /v1/bookings/:id/assignment` and the support page read it back:

```
Tomas took the meeting. Their turn was due first, with a balance of 0.60 turns at weight 3.
Asha was free too, with a balance of 0.40 turns at weight 2.
Mere was outside working hours.
```

## Layout

| Folder | What is in it |
| --- | --- |
| `packages/domain` | Availability, Assignment, Booking. Plain TypeScript, no database, no clock, no randomness |
| `packages/core` | Prisma schema, the booking transaction, outbox, inbox, logs |
| `apps/web` | Next.js, Tailwind, tRPC |
| `apps/api` | NestJS REST API, as a Vercel function |
| `apps/workers` | Lambda functions: relay, calendar sync, email, webhooks |
| `infra` | CDK stack: event bus, queues, dead-letter queues, alarms |
| `checks` | Checkly checks and the alert channel to incident.io |

A booking writes its event to an outbox table in the same transaction. The relay passes it to EventBridge, and each consumer reads its own SQS queue. Delivery is at least once, so consumers drop repeats by event id.

## Run it

Needs Node 22 and Docker.

```
cp .env.example .env
docker compose up -d
npm ci
npm run build:packages
set -a; . ./.env; set +a
npm run db:migrate
npm run db:seed
npm run dev:web        # http://localhost:3000
npm run dev:api        # http://localhost:3001/healthz
npm run dev:workers    # relay and consumers on local queues
```

## Test it

```
docker compose exec postgres createdb -U postgres rr_test
npm test
```

The tests use a real Postgres and real SQS queues (ElasticMQ). The property tests build random teams, zones, weights and buffers around real clock changes. Their idea of a wall clock comes from `Intl` and shares no code with the engine.

## Deploy it

1. Create a Postgres 17 database and a secret named `rr/<stage>/app` with `DATABASE_URL`, `MAIL_FROM`, `SENTRY_DSN`, `ELASTIC_URL`, `ELASTIC_API_KEY`, `CALDAV_USER` and `CALDAV_PASSWORD`.
2. `npm run deploy -w @rr/infra -- -c stage=production -c appUrl=https://... -c incidentUrl=https://...`
3. Two Vercel projects, with the root folders `apps/web` and `apps/api`. Set `DATABASE_URL` to a pooled address. The web project also needs `SUPPORT_KEY`, the API needs `API_KEYS`.
4. Set the secrets that `.github/workflows/release.yml` lists, and `INCIDENT_ALERT_TOKEN` in Checkly, for its alerts.

## What it does not do

- It does not read hosts' calendars. Something else has to send busy times to `PUT /v1/hosts/:hostId/busy`.
- There is no rate limit on the public booking page. Put one in front of it.
- A host is moved to another time by cancelling and booking again.
- Lambda reaches Postgres over the internet. A database inside a VPC needs a VPC configuration in the stack.
