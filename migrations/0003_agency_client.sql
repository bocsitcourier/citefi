-- Migration: Agency hierarchy — parent_team_id + client_status on teams
-- Idempotent (IF NOT EXISTS/ADD COLUMN IF NOT EXISTS) for safe fresh deploys.

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "parent_team_id" integer REFERENCES "teams"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "client_status" varchar(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "teams_parent_team_idx" ON "teams" ("parent_team_id");
CREATE INDEX IF NOT EXISTS "teams_parent_client_status_idx" ON "teams" ("parent_team_id", "client_status");
