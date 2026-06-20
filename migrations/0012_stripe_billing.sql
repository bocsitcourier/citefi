-- Migration: Stripe billing additions
-- Adds stripe_price_id to teams and creates free_tier_grants table.
-- Fully idempotent.

ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "stripe_price_id" varchar(255);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "free_tier_grants" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "device_fingerprint" varchar(255),
  "team_id" integer,
  "granted_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "free_tier_grants" ADD CONSTRAINT "free_tier_grants_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "free_tier_grants_email_idx" ON "free_tier_grants" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "free_tier_grants_device_idx" ON "free_tier_grants" USING btree ("device_fingerprint");
