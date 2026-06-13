-- Migration: Stripe billing columns on teams + billing_events table
-- Applied to Neon DB; this file documents the schema for fresh deploys.

-- Stripe billing columns on teams
ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" varchar(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" varchar(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS "billing_plan" varchar(30) NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS "billing_status" varchar(30) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "current_period_end" timestamp,
  ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean NOT NULL DEFAULT false;

-- Index for stripe customer lookups
CREATE INDEX IF NOT EXISTS "teams_stripe_customer_idx" ON "teams" ("stripe_customer_id");

-- Billing events table — one row per Stripe event, idempotency via unique stripe_event_id
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "stripe_event_id" varchar(255) NOT NULL UNIQUE,
  "event_type" varchar(100) NOT NULL,
  "team_id" integer REFERENCES "teams"("id") ON DELETE SET NULL,
  "processed_at" timestamp NOT NULL DEFAULT now(),
  "payload" jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_events_stripe_event_idx" ON "billing_events" ("stripe_event_id");
CREATE INDEX IF NOT EXISTS "billing_events_team_idx" ON "billing_events" ("team_id");
