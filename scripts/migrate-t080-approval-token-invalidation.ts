/**
 * Migration script — T080: Approval Token Invalidation
 * Creates the used_approval_tokens table for replay-attack prevention on
 * one-click admin approval / rejection email links.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t080-approval-token-invalidation.ts
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log("🔄 Running T080 approval token invalidation migration...");

  await sql`
    CREATE TABLE IF NOT EXISTS used_approval_tokens (
      id          SERIAL PRIMARY KEY,
      token_signature VARCHAR(512) NOT NULL UNIQUE,
      expires_at  TIMESTAMPTZ  NOT NULL,
      action      VARCHAR(10)  NOT NULL,
      used_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `;
  console.log("  ✓ used_approval_tokens table");

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS used_approval_tokens_signature_idx
      ON used_approval_tokens (token_signature)
  `;
  console.log("  ✓ unique index on token_signature");

  await sql`
    CREATE INDEX IF NOT EXISTS used_approval_tokens_expires_at_idx
      ON used_approval_tokens (expires_at)
  `;
  console.log("  ✓ index on expires_at (for pruning)");

  console.log("✅ T080 migration complete.");
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
