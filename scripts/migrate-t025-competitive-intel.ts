/**
 * Migration script — T025: Competitive Intelligence Service
 * Adds source, external_url, external_platform, validated_by_own_audience columns
 * to learning_patterns table with safe defaults for existing rows.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t025-competitive-intel.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T025 competitive intelligence migration...");

  // Add source column (internal | external), default 'internal' for all existing rows
  await sql`
    ALTER TABLE learning_patterns
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'internal'
  `;
  console.log("  ✓ source column");

  // Add external_url — URL of top-performing content pattern was extracted from
  await sql`
    ALTER TABLE learning_patterns
    ADD COLUMN IF NOT EXISTS external_url TEXT
  `;
  console.log("  ✓ external_url column");

  // Add external_platform — youtube, tiktok, instagram, linkedin, podcast, etc.
  await sql`
    ALTER TABLE learning_patterns
    ADD COLUMN IF NOT EXISTS external_platform VARCHAR(50)
  `;
  console.log("  ✓ external_platform column");

  // Add validated_by_own_audience — false for new external patterns, set to true by learning loop
  // Existing rows are internal and already validated, so default true for them.
  await sql`
    ALTER TABLE learning_patterns
    ADD COLUMN IF NOT EXISTS validated_by_own_audience BOOLEAN NOT NULL DEFAULT false
  `;
  // Backfill: all existing (internal) rows are treated as validated
  await sql`
    UPDATE learning_patterns
    SET validated_by_own_audience = true
    WHERE source = 'internal' AND validated_by_own_audience = false
  `;
  console.log("  ✓ validated_by_own_audience column (backfilled existing rows → true)");

  // Index for efficient querying of external patterns per team
  await sql`
    CREATE INDEX IF NOT EXISTS lp_source_idx ON learning_patterns(source)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS lp_team_source_idx ON learning_patterns(team_id, source)
  `;
  console.log("  ✓ indexes on source");

  console.log("✅ T025 migration complete.");
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
