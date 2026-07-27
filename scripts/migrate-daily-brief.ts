/**
 * Migration script — T011: Daily Marketing Brief
 * Adds tables for daily briefs, user preferences, deliveries, and competitor intake.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-daily-brief.ts
 */
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

async function run() {
  console.log("🔄 Running T011 Daily Marketing Brief migration...");

  // 1. daily_brief_preferences
  console.log("⏳ Creating daily_brief_preferences table...");
  await sql`
    CREATE TABLE IF NOT EXISTS daily_brief_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      cadence VARCHAR(20) NOT NULL DEFAULT 'daily',
      timezone VARCHAR(60) NOT NULL DEFAULT 'America/New_York',
      send_hour_local SMALLINT NOT NULL DEFAULT 7,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      in_app_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS dbp_user_id_idx ON daily_brief_preferences(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS dbp_team_id_idx ON daily_brief_preferences(team_id)`;
  console.log("  ✓ daily_brief_preferences table and indexes");

  // 2. daily_briefs
  console.log("⏳ Creating daily_briefs table...");
  await sql`
    CREATE TABLE IF NOT EXISTS daily_briefs (
      id SERIAL PRIMARY KEY,
      public_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      local_date VARCHAR(10) NOT NULL,
      tier VARCHAR(20) NOT NULL DEFAULT 'starter',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      today_focus_type VARCHAR(50),
      sections_json JSONB,
      source_metrics_json JSONB,
      cta_url TEXT,
      generated_at TIMESTAMP,
      viewed_at TIMESTAMP,
      emailed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS db_user_date_idx ON daily_briefs(user_id, local_date)`;
  await sql`CREATE INDEX IF NOT EXISTS db_team_id_idx ON daily_briefs(team_id)`;
  await sql`CREATE INDEX IF NOT EXISTS db_public_id_idx ON daily_briefs(public_id)`;
  console.log("  ✓ daily_briefs table and indexes");

  // 3. daily_brief_deliveries
  console.log("⏳ Creating daily_brief_deliveries table...");
  await sql`
    CREATE TABLE IF NOT EXISTS daily_brief_deliveries (
      id SERIAL PRIMARY KEY,
      brief_id INTEGER NOT NULL REFERENCES daily_briefs(id) ON DELETE CASCADE,
      channel VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      provider_message_id TEXT,
      error TEXT,
      sent_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS dbd_brief_id_idx ON daily_brief_deliveries(brief_id)`;
  console.log("  ✓ daily_brief_deliveries table and indexes");

  // 4. signup_competitor_intake
  console.log("⏳ Creating signup_competitor_intake table...");
  await sql`
    CREATE TABLE IF NOT EXISTS signup_competitor_intake (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      company_name VARCHAR(255),
      website_url TEXT,
      team_name VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      resolved_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      payload_json JSONB,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS sci_email_idx ON signup_competitor_intake(email)`;
  await sql`CREATE INDEX IF NOT EXISTS sci_status_idx ON signup_competitor_intake(status)`;
  console.log("  ✓ signup_competitor_intake table and indexes");

  console.log("✅ T011 migration complete.");
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
