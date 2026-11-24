-- uuid equality inside a GiST index, needed by booking_no_overlap
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."host" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "calendar_url" TEXT,

    CONSTRAINT "host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."working_hours" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."date_override" (
    "host_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "windows" JSONB NOT NULL,

    CONSTRAINT "date_override_pkey" PRIMARY KEY ("host_id","local_date")
);

-- CreateTable
CREATE TABLE "public"."busy_block" (
    "id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL,
    "to_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "busy_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."event_type" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "slot_step_minutes" INTEGER NOT NULL,
    "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
    "minimum_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "horizon_days" INTEGER NOT NULL DEFAULT 60,
    "daily_cap_per_host" INTEGER,
    "synthetic" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "event_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."rotation_member" (
    "event_type_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "last_assigned_at" TIMESTAMPTZ(3),

    CONSTRAINT "rotation_member_pkey" PRIMARY KEY ("event_type_id","host_id")
);

-- CreateTable
CREATE TABLE "public"."booking" (
    "id" UUID NOT NULL,
    "event_type_id" UUID NOT NULL,
    "host_id" UUID NOT NULL,
    "status" "public"."BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_from" TIMESTAMPTZ(3) NOT NULL,
    "blocked_to" TIMESTAMPTZ(3) NOT NULL,
    "invitee_name" TEXT NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "invitee_zone" TEXT NOT NULL,
    "manage_token" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."assignment_decision" (
    "booking_id" UUID NOT NULL,
    "decision" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL,

    CONSTRAINT "assignment_decision_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "public"."outbox_event" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "claimed_until" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."inbox_entry" (
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "lease_until" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inbox_entry_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "public"."webhook_subscription" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "host_email_key" ON "public"."host"("email");

-- CreateIndex
CREATE INDEX "working_hours_host_id_idx" ON "public"."working_hours"("host_id");

-- CreateIndex
CREATE INDEX "busy_block_host_id_from_at_idx" ON "public"."busy_block"("host_id", "from_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_type_slug_key" ON "public"."event_type"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "booking_manage_token_key" ON "public"."booking"("manage_token");

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_key_key" ON "public"."booking"("idempotency_key");

-- CreateIndex
CREATE INDEX "booking_host_id_start_at_idx" ON "public"."booking"("host_id", "start_at");

-- AddForeignKey
ALTER TABLE "public"."working_hours" ADD CONSTRAINT "working_hours_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."date_override" ADD CONSTRAINT "date_override_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."busy_block" ADD CONSTRAINT "busy_block_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rotation_member" ADD CONSTRAINT "rotation_member_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."rotation_member" ADD CONSTRAINT "rotation_member_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."booking" ADD CONSTRAINT "booking_event_type_id_fkey" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."booking" ADD CONSTRAINT "booking_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."host"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."assignment_decision" ADD CONSTRAINT "assignment_decision_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A host cannot hold two confirmed meetings whose blocked ranges overlap, whichever rotation
-- they came from. The row lock on event_type cannot see across rotations, this can.
ALTER TABLE "booking" ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("blocked_from", "blocked_to", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED');

ALTER TABLE "booking" ADD CONSTRAINT "booking_times_ordered"
  CHECK ("blocked_from" <= "start_at" AND "start_at" < "end_at" AND "end_at" <= "blocked_to");

ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_valid"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440);

ALTER TABLE "busy_block" ADD CONSTRAINT "busy_block_ordered" CHECK ("from_at" < "to_at");

ALTER TABLE "event_type" ADD CONSTRAINT "event_type_positive"
  CHECK ("duration_minutes" > 0 AND "slot_step_minutes" > 0 AND "buffer_before_minutes" >= 0 AND "buffer_after_minutes" >= 0);

ALTER TABLE "rotation_member" ADD CONSTRAINT "rotation_member_weight" CHECK ("weight" BETWEEN 1 AND 1000);

-- Only unpublished rows are ever scanned by the relay.
CREATE INDEX "outbox_event_pending" ON "outbox_event" ("seq") WHERE "published_at" IS NULL;
