/**
 * Migration script — T107: Revoked Approval Tokens
 * Creates the revoked_approval_tokens table for deliberate per-user link
 * revocation by admins before the token is consumed.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t107-revoked-approval-tokens.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T107 revoked approval tokens migration...");

  await sql`
    CREATE TABLE IF NOT EXISTS revoked_approval_tokens (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revoked_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      revoked_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
      expires_at  TIMESTAMPTZ  NOT NULL
    )
  `;
  console.log("  ✓ revoked_approval_tokens table");

  await sql`
    CREATE INDEX IF NOT EXISTS revoked_approval_tokens_user_id_idx
      ON revoked_approval_tokens (user_id)
  `;
  console.log("  ✓ index on user_id");

  await sql`
    CREATE INDEX IF NOT EXISTS revoked_approval_tokens_expires_at_idx
      ON revoked_approval_tokens (expires_at)
  `;
  console.log("  ✓ index on expires_at (for pruning)");

  console.log("✅ T107 migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
