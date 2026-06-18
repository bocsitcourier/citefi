/**
 * Migration script — T015 Client Brand Profiles
 * Run with: node --env-file=.env.local --import tsx/esm scripts/migrate-t015-brand-profiles.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T015 client_brand_profiles migration...");

  await sql`
    CREATE TABLE IF NOT EXISTS client_brand_profiles (
      id                    SERIAL PRIMARY KEY,
      team_id               INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
      website_url           TEXT NOT NULL,
      company_name          VARCHAR(255) NOT NULL,
      status                VARCHAR(20) NOT NULL DEFAULT 'pending',
      progress_step         VARCHAR(50),
      profile_json          JSONB,
      raw_research_json     JSONB,
      manual_overrides_json JSONB,
      error_message         TEXT,
      last_run_at           TIMESTAMP,
      created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS cbp_team_id_idx ON client_brand_profiles(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS cbp_status_idx  ON client_brand_profiles(status)`;
  console.log("  ✓ client_brand_profiles");

  console.log("✅ T015 migration complete");
}

run().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});
