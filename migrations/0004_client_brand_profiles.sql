-- Migration: Client Brand Profiles — Task #15 Client Intelligence Engine
-- One row per team; stores the full 8-dimension brand intelligence profile.

CREATE TABLE IF NOT EXISTS "client_brand_profiles" (
  "id"                   serial PRIMARY KEY,
  "team_id"              integer NOT NULL UNIQUE REFERENCES "teams"("id") ON DELETE CASCADE,
  "website_url"          text NOT NULL,
  "company_name"         varchar(255) NOT NULL,
  "status"               varchar(20) NOT NULL DEFAULT 'pending',
  "progress_step"        varchar(50),
  "profile_json"         jsonb,
  "raw_research_json"    jsonb,
  "manual_overrides_json" jsonb,
  "error_message"        text,
  "last_run_at"          timestamp,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cbp_team_id_idx"  ON "client_brand_profiles" ("team_id");
CREATE INDEX IF NOT EXISTS "cbp_status_idx"   ON "client_brand_profiles" ("status");
