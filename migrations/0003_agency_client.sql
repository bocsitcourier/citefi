-- Migration: Agency hierarchy — parent_team_id + client_status on teams
-- Idempotent (IF NOT EXISTS/ADD COLUMN IF NOT EXISTS) for safe fresh deploys.

ALTER TABLE "teams"
  ADD COLUMN IF NOT EXISTS "parent_team_id" integer REFERENCES "teams"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "client_status" varchar(20) NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "teams_parent_team_idx" ON "teams" ("parent_team_id");
CREATE INDEX IF NOT EXISTS "teams_parent_client_status_idx" ON "teams" ("parent_team_id", "client_status");

-- ============================================================================
-- Task #16: is_archived column on learning_patterns
-- ============================================================================
ALTER TABLE "learning_patterns" ADD COLUMN IF NOT EXISTS "is_archived" boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS "learning_patterns_archived_idx" ON "learning_patterns" ("is_archived");

-- ============================================================================
-- Task #16: variant_arms table (pattern-level Thompson Sampling arms)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "variant_arms" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "content_type" varchar(50) NOT NULL,
  "arm_name" varchar(50) NOT NULL DEFAULT 'treatment',
  "allocation_pct" integer NOT NULL DEFAULT 90,
  "is_active" boolean NOT NULL DEFAULT true,
  "baseline_pattern_ids" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "va_team_content_idx" ON "variant_arms" ("team_id", "content_type");
CREATE INDEX IF NOT EXISTS "va_active_idx" ON "variant_arms" ("is_active");

-- ============================================================================
-- Task #17: cohort_insights table (Cohort Strategy Intelligence)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "cohort_insights" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "cohort_dimension" varchar(100) NOT NULL,
  "cohort_value" varchar(255) NOT NULL,
  "conversion_rate" integer NOT NULL DEFAULT 0,
  "engagement_score" integer NOT NULL DEFAULT 0,
  "sample_size" integer NOT NULL DEFAULT 0,
  "vs_baseline_multiplier" integer NOT NULL DEFAULT 100,
  "insight_type" varchar(50) NOT NULL DEFAULT 'converter_cohort',
  "recommendation_text" text,
  "computed_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "ci_team_idx" ON "cohort_insights" ("team_id");
CREATE INDEX IF NOT EXISTS "ci_insight_type_idx" ON "cohort_insights" ("insight_type");
CREATE INDEX IF NOT EXISTS "ci_computed_at_idx" ON "cohort_insights" ("computed_at");
CREATE INDEX IF NOT EXISTS "ci_team_type_idx" ON "cohort_insights" ("team_id", "insight_type");

-- Task #16: 3-consecutive-week gate for underperformer archiving
ALTER TABLE learning_patterns ADD COLUMN IF NOT EXISTS weak_week_count SMALLINT NOT NULL DEFAULT 0;
