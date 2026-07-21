/**
 * Migration script — T088: Add user_id to used_approval_tokens
 * Adds a user_id column (FK → users.id) to the used_approval_tokens table so
 * the admin panel can surface a "Link used" badge per pending user.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t088-approval-token-user-id.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T088 approval token user_id migration...");

  await sql`
    ALTER TABLE used_approval_tokens
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
  `;
  console.log("  ✓ user_id column added (nullable FK → users.id)");

  await sql`
    CREATE INDEX IF NOT EXISTS used_approval_tokens_user_id_idx
      ON used_approval_tokens (user_id)
  `;
  console.log("  ✓ index on user_id");

  console.log("✅ T088 migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
