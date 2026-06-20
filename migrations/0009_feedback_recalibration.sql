-- Migration: content_feedback + judge_recalibration_queue
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) for safe fresh deploys.
-- content_feedback was in schema.ts from the start but never had a migration file.
-- This migration brings the DB in sync and also extends the table for all content types.

-- ============================================================================
-- content_feedback — user thumb ratings on any generated content piece.
-- Canonical contentType values: article | social | podcast | video
-- (Legacy UI value "social_post" is normalised to "social" at the API layer.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "content_feedback" (
  "id"           serial        PRIMARY KEY NOT NULL,
  "team_id"      integer       NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "user_id"      integer       NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content_type" varchar(50)   NOT NULL,
  "article_id"   integer       REFERENCES "articles"("id") ON DELETE CASCADE,
  "social_post_id" integer     REFERENCES "social_posts"("id") ON DELETE CASCADE,
  "video_idea_id"  integer     REFERENCES "video_ideas"("id") ON DELETE CASCADE,
  "rating"       varchar(10)   NOT NULL,
  "comment"      text,
  "metric_id"    integer,
  "created_at"   timestamp     NOT NULL DEFAULT now()
);

-- Extend table if it already existed with the narrower schema (add missing columns idempotently)
ALTER TABLE "content_feedback" ADD COLUMN IF NOT EXISTS "video_idea_id" integer REFERENCES "video_ideas"("id") ON DELETE CASCADE;

-- Widen content_type if it was previously varchar(20)
-- PostgreSQL allows widening a varchar constraint without a table rewrite.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'content_feedback'
      AND column_name = 'content_type'
      AND character_maximum_length < 50
  ) THEN
    ALTER TABLE "content_feedback" ALTER COLUMN "content_type" TYPE varchar(50);
  END IF;
END
$$;

-- Normalise any legacy "social_post" values already stored
UPDATE "content_feedback" SET "content_type" = 'social' WHERE "content_type" = 'social_post';

-- Indexes (all idempotent)
CREATE INDEX IF NOT EXISTS "content_feedback_team_id_idx"      ON "content_feedback" ("team_id");
CREATE INDEX IF NOT EXISTS "content_feedback_content_type_idx" ON "content_feedback" ("content_type");
CREATE INDEX IF NOT EXISTS "content_feedback_rating_idx"       ON "content_feedback" ("rating");
CREATE INDEX IF NOT EXISTS "content_feedback_created_at_idx"   ON "content_feedback" ("created_at");

-- ============================================================================
-- judge_recalibration_queue — written when human feedback contradicts the AI
-- judge score. Used to surface rubric gaps for human review or future fine-tuning.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "judge_recalibration_queue" (
  "id"                    serial        PRIMARY KEY NOT NULL,
  "team_id"               integer       NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "content_type"          varchar(50)   NOT NULL,
  "article_id"            integer       REFERENCES "articles"("id") ON DELETE CASCADE,
  "social_post_id"        integer       REFERENCES "social_posts"("id") ON DELETE CASCADE,
  "video_idea_id"         integer       REFERENCES "video_ideas"("id") ON DELETE CASCADE,
  -- Human feedback signal
  "human_rating"          integer       NOT NULL,         -- 1–5 stars
  "human_is_success"      boolean       NOT NULL,         -- derived from rating
  -- AI judge signal at time of feedback
  "judge_score"           integer,                        -- 0–100 composite quality score
  "judge_dimension_scores" jsonb,                         -- {completeness,factuality,…}
  -- Conflict details
  "conflict_dimension"    varchar(50),                    -- which dimension disagreed most
  "conflict_magnitude"    integer,                        -- abs(human - judge) scaled 0–100
  -- Processing
  "status"                varchar(20)   NOT NULL DEFAULT 'pending',
  "review_notes"          text,
  "resolved_at"           timestamp,
  "created_at"            timestamp     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "jrq_team_idx"        ON "judge_recalibration_queue" ("team_id");
CREATE INDEX IF NOT EXISTS "jrq_status_idx"      ON "judge_recalibration_queue" ("status");
CREATE INDEX IF NOT EXISTS "jrq_created_at_idx"  ON "judge_recalibration_queue" ("created_at");
CREATE INDEX IF NOT EXISTS "jrq_team_status_idx" ON "judge_recalibration_queue" ("team_id", "status");
