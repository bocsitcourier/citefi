/**
 * Migration — T110: add video_credit_run_id and video_cap_reservation_id to social_posts
 *
 * These columns persist the BullMQ credit-reservation runId and the spending-cap
 * usageEvent ID on the row so that job-recovery can release stranded credit holds
 * and cancel the exact cap reservation when storage is not configured or a worker
 * restart leaves posts stuck at GENERATING.
 *
 * Run: node --env-file=.env.local --import tsx/esm scripts/migrate-t110-video-credit-run-id.ts
 */
import { neon } from "@neondatabase/serverless";
import pg from "pg";

async function run() {
  const dbUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL ?? "";
  if (!dbUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");

  const isLocal = !dbUrl.includes("neon.tech") && !dbUrl.includes("@helium");
  console.log(`🔄 Running T110 migration (${isLocal ? "local PostgreSQL" : "Neon"})...`);

  if (isLocal) {
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      await client.query(`
        ALTER TABLE social_posts
        ADD COLUMN IF NOT EXISTS video_credit_run_id VARCHAR(255)
      `);
      console.log("  ✓ video_credit_run_id column added (or already exists)");
      await client.query(`
        ALTER TABLE social_posts
        ADD COLUMN IF NOT EXISTS video_cap_reservation_id INTEGER
      `);
      console.log("  ✓ video_cap_reservation_id column added (or already exists)");
    } finally {
      await client.end();
    }
  } else {
    const sql = neon(dbUrl);
    await sql`
      ALTER TABLE social_posts
      ADD COLUMN IF NOT EXISTS video_credit_run_id VARCHAR(255)
    `;
    console.log("  ✓ video_credit_run_id column added (or already exists)");
    await sql`
      ALTER TABLE social_posts
      ADD COLUMN IF NOT EXISTS video_cap_reservation_id INTEGER
    `;
    console.log("  ✓ video_cap_reservation_id column added (or already exists)");
  }

  console.log("✅ T110 migration complete.");
}

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
