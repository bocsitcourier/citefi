/**
 * Migration — T119: durable enqueue/stage checkpoints for restart-safe workers.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t119-article-run-checkpoints.ts
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");

const sql = neon(databaseUrl);

await sql`
  ALTER TABLE article_runs
    ADD COLUMN IF NOT EXISTS queued_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS lease_token VARCHAR(36),
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS gemini_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS chatgpt_reviewed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS text_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS image_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS image_lease_token VARCHAR(36),
    ADD COLUMN IF NOT EXISTS image_lease_expires_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS billing_team_id INTEGER REFERENCES teams(id),
    ADD COLUMN IF NOT EXISTS billing_run_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS billing_amount INTEGER,
    ADD COLUMN IF NOT EXISTS billing_job_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS settlement_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS settlement_last_error TEXT,
    ADD COLUMN IF NOT EXISTS settlement_next_attempt_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS enqueue_failed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS enqueue_error TEXT
`;

await sql`
  UPDATE article_runs
  SET queued_at = COALESCE(queued_at, started_at)
  WHERE queued_at IS NULL
`;

await sql`
  ALTER TABLE article_runs
    ALTER COLUMN queued_at SET DEFAULT NOW(),
    ALTER COLUMN queued_at SET NOT NULL,
    ALTER COLUMN status TYPE VARCHAR(30),
    ALTER COLUMN status SET DEFAULT 'queued'
`;

// Backfill only from explicit durable stage states. Do not infer a checkpoint
// from merely non-null content, which may be a partial write from a crashed run.
await sql`
  UPDATE article_runs ar
  SET
    gemini_generated_at = COALESCE(ar.gemini_generated_at, ar.completed_at, ar.started_at),
    chatgpt_reviewed_at = CASE
      WHEN a.article_status IN ('CHATGPT_REVIEWED', 'GPT4_ENHANCED', 'COMPLETE')
      THEN COALESCE(ar.chatgpt_reviewed_at, ar.completed_at, ar.started_at)
      ELSE ar.chatgpt_reviewed_at
    END,
    text_generated_at = CASE
      WHEN a.article_status IN ('GPT4_ENHANCED', 'COMPLETE')
      THEN COALESCE(ar.text_generated_at, ar.completed_at, ar.started_at)
      ELSE ar.text_generated_at
    END,
    image_generated_at = CASE
      WHEN a.hero_image_url IS NOT NULL
      THEN COALESCE(ar.image_generated_at, ar.completed_at, ar.started_at)
      ELSE ar.image_generated_at
    END
  FROM articles a
  WHERE a.id = ar.article_id
    AND a.article_status IN ('GEMINI_COMPLETE', 'CHATGPT_REVIEWED', 'GPT4_ENHANCED', 'COMPLETE')
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS article_runs_run_id_unique
    ON article_runs (run_id)
`;

await sql`
  CREATE INDEX IF NOT EXISTS article_runs_status_queued_at_idx
    ON article_runs (status, queued_at)
`;

await sql`
  CREATE INDEX IF NOT EXISTS article_runs_settlement_idx
    ON article_runs (status, settlement_next_attempt_at)
`;

await sql`
  CREATE INDEX IF NOT EXISTS article_runs_billing_run_id_idx
    ON article_runs (billing_run_id)
`;

console.log("✅ T119 article-run checkpoint migration complete");