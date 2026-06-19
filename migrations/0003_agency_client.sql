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

-- Task #16: Separate variant_arm_id column (FK → variant_arms) in content_performance_metrics.
-- Keeps arm_id pointing to decision_arms and avoids FK violations when writing variant_arms.id.
ALTER TABLE content_performance_metrics ADD COLUMN IF NOT EXISTS variant_arm_id INTEGER REFERENCES variant_arms(id) ON DELETE SET NULL;

-- Task #16: session_return_rate — % of unique visitors returning on a different day (Gate C guardrail)
ALTER TABLE content_performance_metrics ADD COLUMN IF NOT EXISTS session_return_rate INTEGER NOT NULL DEFAULT 0;

-- Task #16: terminal_kpi on variant_arms — arm-level KPI config so learning service resolves
-- metric weights from the arm itself (universal for all content types, no caller threading required).
ALTER TABLE variant_arms ADD COLUMN IF NOT EXISTS terminal_kpi VARCHAR(50);

-- ============================================================================
-- Task #17: cohort_insights — Gap L (terminalKpi) + Gap N (contentTypeBlocked)
-- ============================================================================
ALTER TABLE cohort_insights ADD COLUMN IF NOT EXISTS terminal_kpi VARCHAR(30);
ALTER TABLE cohort_insights ADD COLUMN IF NOT EXISTS content_type_blocked VARCHAR(50);

-- Task #17: audience_personas — behavioral enrichment notes from CohortMiningJob
ALTER TABLE audience_personas ADD COLUMN IF NOT EXISTS performance_notes TEXT;

-- ============================================================================
-- Task #18: Journey Orchestrator + Cadence Optimizer
-- ============================================================================

CREATE TABLE IF NOT EXISTS "journey_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "template_type" varchar(50) NOT NULL,
  "steps_config" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_builtin" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "jt_type_idx" ON "journey_templates" ("template_type");
CREATE INDEX IF NOT EXISTS "jt_builtin_idx" ON "journey_templates" ("is_builtin");

CREATE TABLE IF NOT EXISTS "journeys" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "name" varchar(255) NOT NULL,
  "template_type" varchar(50),
  "template_id" integer REFERENCES "journey_templates"("id") ON DELETE SET NULL,
  "trigger_type" varchar(20) NOT NULL DEFAULT 'manual',
  "status" varchar(20) NOT NULL DEFAULT 'draft',
  "terminal_kpi" varchar(50) NOT NULL,
  "locale" varchar(20),
  "locale_config" jsonb,
  "trigger_article_id" integer,
  "triggered_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "j_team_idx" ON "journeys" ("team_id");
CREATE INDEX IF NOT EXISTS "j_status_idx" ON "journeys" ("status");
CREATE INDEX IF NOT EXISTS "j_team_status_idx" ON "journeys" ("team_id", "status");

CREATE TABLE IF NOT EXISTS "journey_steps" (
  "id" serial PRIMARY KEY NOT NULL,
  "journey_id" integer NOT NULL REFERENCES "journeys"("id") ON DELETE CASCADE,
  "step_index" integer NOT NULL,
  "content_type" varchar(50) NOT NULL,
  "day_offset" integer NOT NULL DEFAULT 0,
  "topic_angle" text,
  "channel" varchar(50),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "article_id" integer,
  "batch_id" integer,
  "scheduled_for" timestamp,
  "published_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "js_journey_idx" ON "journey_steps" ("journey_id");
CREATE INDEX IF NOT EXISTS "js_status_idx" ON "journey_steps" ("status");
CREATE INDEX IF NOT EXISTS "js_scheduled_idx" ON "journey_steps" ("scheduled_for");
CREATE INDEX IF NOT EXISTS "js_status_scheduled_idx" ON "journey_steps" ("status", "scheduled_for");

CREATE TABLE IF NOT EXISTS "cadence_performance" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "content_type" varchar(50) NOT NULL,
  "weekly_frequency" integer NOT NULL,
  "avg_engagement_score" integer NOT NULL DEFAULT 0,
  "avg_conversion_rate" integer NOT NULL DEFAULT 0,
  "sample_size" integer NOT NULL DEFAULT 0,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "computed_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cp_team_idx" ON "cadence_performance" ("team_id");
CREATE INDEX IF NOT EXISTS "cp_team_content_idx" ON "cadence_performance" ("team_id", "content_type");
CREATE INDEX IF NOT EXISTS "cp_computed_at_idx" ON "cadence_performance" ("computed_at");

-- Seed 5 prebuilt journey templates
INSERT INTO "journey_templates" ("name", "description", "template_type", "steps_config", "is_builtin")
SELECT 'Local SEO Journey', 'Pillar article → social amplification → podcast → video. The go-to sequence for local service businesses.', 'local_seo',
  '[{"stepIndex":0,"contentType":"article","dayOffset":0,"topicAngle":"Pillar: comprehensive local SEO authority piece"},{"stepIndex":1,"contentType":"social","dayOffset":1,"topicAngle":"Key takeaway social post with local hook","channel":"facebook"},{"stepIndex":2,"contentType":"social","dayOffset":3,"topicAngle":"FAQ-style social post answering top local question","channel":"instagram"},{"stepIndex":3,"contentType":"social","dayOffset":7,"topicAngle":"Testimonial-style social post highlighting local authority","channel":"linkedin"},{"stepIndex":4,"contentType":"podcast","dayOffset":14,"topicAngle":"Deep-dive podcast episode summarizing pillar article insights"},{"stepIndex":5,"contentType":"video","dayOffset":21,"topicAngle":"60-second video summary with local CTA"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM "journey_templates" WHERE "template_type" = 'local_seo' AND "is_builtin" = true);

INSERT INTO "journey_templates" ("name", "description", "template_type", "steps_config", "is_builtin")
SELECT 'Product Launch Journey', 'Announcement social → article deep-dive → FAQ → testimonial → podcast. Perfect for new service or product launches.', 'product_launch',
  '[{"stepIndex":0,"contentType":"social","dayOffset":0,"topicAngle":"Launch announcement with excitement hook","channel":"facebook"},{"stepIndex":1,"contentType":"article","dayOffset":2,"topicAngle":"Deep-dive article: everything you need to know about [product]"},{"stepIndex":2,"contentType":"article","dayOffset":5,"topicAngle":"FAQ article: top 10 questions about [product] answered"},{"stepIndex":3,"contentType":"social","dayOffset":10,"topicAngle":"Testimonial-style social post with early adopter results","channel":"linkedin"},{"stepIndex":4,"contentType":"podcast","dayOffset":20,"topicAngle":"Podcast interview-style episode: the story behind the launch"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM "journey_templates" WHERE "template_type" = 'product_launch' AND "is_builtin" = true);

INSERT INTO "journey_templates" ("name", "description", "template_type", "steps_config", "is_builtin")
SELECT 'Thought Leadership Journey', 'Opinion article → LinkedIn posts → podcast. Establishes authority and drives professional audience engagement.', 'thought_leadership',
  '[{"stepIndex":0,"contentType":"article","dayOffset":0,"topicAngle":"Opinion/perspective article: bold take on industry trend"},{"stepIndex":1,"contentType":"social","dayOffset":1,"topicAngle":"LinkedIn post: sharp insight from article","channel":"linkedin"},{"stepIndex":2,"contentType":"social","dayOffset":3,"topicAngle":"LinkedIn post: contrarian data point from article","channel":"linkedin"},{"stepIndex":3,"contentType":"social","dayOffset":7,"topicAngle":"LinkedIn post: practical takeaway with engagement question","channel":"linkedin"},{"stepIndex":4,"contentType":"podcast","dayOffset":14,"topicAngle":"Podcast episode expanding on article thesis with examples"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM "journey_templates" WHERE "template_type" = 'thought_leadership' AND "is_builtin" = true);

INSERT INTO "journey_templates" ("name", "description", "template_type", "steps_config", "is_builtin")
SELECT 'Evergreen SEO Journey', 'Article → 5 social variants → video. Maximizes long-term organic traffic from a single core piece.', 'evergreen_seo',
  '[{"stepIndex":0,"contentType":"article","dayOffset":0,"topicAngle":"Comprehensive evergreen how-to or guide"},{"stepIndex":1,"contentType":"social","dayOffset":1,"topicAngle":"Social post: top 3 tips from article"},{"stepIndex":2,"contentType":"social","dayOffset":2,"topicAngle":"Social post: common mistake people make (from article)"},{"stepIndex":3,"contentType":"social","dayOffset":5,"topicAngle":"Social post: step-by-step breakdown of key section"},{"stepIndex":4,"contentType":"social","dayOffset":9,"topicAngle":"Social post: stats and data callout from article"},{"stepIndex":5,"contentType":"social","dayOffset":14,"topicAngle":"Social post: before/after or transformation story"},{"stepIndex":6,"contentType":"video","dayOffset":30,"topicAngle":"60-second video: the single most important insight from article"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM "journey_templates" WHERE "template_type" = 'evergreen_seo' AND "is_builtin" = true);

INSERT INTO "journey_templates" ("name", "description", "template_type", "steps_config", "is_builtin")
SELECT 'Churn Rescue Journey', '3 engagement social posts → value article → video testimonial. Re-engages at-risk audience segments.', 'churn_rescue',
  '[{"stepIndex":0,"contentType":"social","dayOffset":0,"topicAngle":"Re-engagement social: reminder of core value delivered","channel":"facebook"},{"stepIndex":1,"contentType":"social","dayOffset":2,"topicAngle":"Engagement social: ask a question, invite response","channel":"instagram"},{"stepIndex":2,"contentType":"social","dayOffset":5,"topicAngle":"Value social: exclusive tip or insight for loyal audience","channel":"linkedin"},{"stepIndex":3,"contentType":"article","dayOffset":7,"topicAngle":"Value-demonstration article: ROI and results from working with us"},{"stepIndex":4,"contentType":"video","dayOffset":14,"topicAngle":"Video testimonial: real customer story and outcome"}]'::jsonb,
  true
WHERE NOT EXISTS (SELECT 1 FROM "journey_templates" WHERE "template_type" = 'churn_rescue' AND "is_builtin" = true);

-- ============================================================================
-- Architect Review Fixes: missing index + IDOR hardening
-- ============================================================================

-- Missing index on content_performance_metrics.variant_arm_id
-- Required for lift analytics and declare-winner Gate B arm grouping queries.
CREATE INDEX IF NOT EXISTS "cpm_variant_arm_id_idx" ON "content_performance_metrics" ("variant_arm_id");

-- Compound index for declare-winner Gate A/B/C and ConversionLabeler lookups
-- (team_id + content_type + variant_id is the most common filter combination)
CREATE INDEX IF NOT EXISTS "cpm_team_content_variant_idx" ON "content_performance_metrics" ("team_id", "content_type", "variant_id");
