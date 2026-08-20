/**
 * Migration — T113: article stall watchdog fields.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t113-article-stall-watchdog.ts
 */
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or NEON_DATABASE_URL is required");

const sql = neon(databaseUrl);

await sql`
  ALTER TABLE articles
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS stall_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_stalled_at TIMESTAMP
`;

console.log("✅ T113 article stall watchdog migration complete");