/**
 * Apply (or roll back) the campaigns aggregate migration atomically — Task #151.
 *
 * Installs the campaigns / campaign_exports tables, the nullable campaign_id
 * columns + same-team composite foreign keys + indexes on the nine content
 * roots, the ENABLE + FORCE RLS policies/grants/sequences for the two new tables
 * (reusing the citefi_rls helpers from migration 0014), and the idempotent
 * campaign backfill, all defined in migrations/0015_campaigns.sql.
 *
 * The SQL file wraps everything in its own BEGIN/COMMIT, so the whole script is
 * applied as one atomic unit: if any statement fails, PostgreSQL rolls the batch
 * back and nothing is left half-installed. Both the migration and the rollback
 * are idempotent (IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE / DO-guards), so
 * re-running is always safe.
 *
 * Uses the pg TCP driver (NOT the Neon HTTP driver) because the migration
 * contains multi-statement DO-blocks and transaction control the HTTP driver
 * cannot execute as one atomic batch.
 *
 * ORDERING: run AFTER migration 0014 (tenant RLS) so the citefi_rls schema and
 * citefi_tenant role exist; the SQL degrades gracefully (RAISE NOTICE) if they
 * are missing, but the RLS policies for campaigns would then be skipped.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t151-campaigns.ts
 *   node --env-file=.env.local --import tsx/esm scripts/migrate-t151-campaigns.ts --rollback
 *
 * Env:
 *   DATABASE_URL (required) — a direct (non-pooled) connection is preferred so
 *                             DDL takes effect immediately.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL (or NEON_DATABASE_URL) must be set to apply the campaigns migration");
}

const rollback = process.argv.includes("--rollback");
const fileName = rollback ? "0015_campaigns_rollback.sql" : "0015_campaigns.sql";
const sqlPath = join(__dirname, "..", "migrations", fileName);

let sqlText: string;
try {
  sqlText = readFileSync(sqlPath, "utf8");
} catch (err) {
  throw new Error(`Could not read migration file at ${sqlPath}: ${(err as Error).message}`);
}

if (!sqlText.trim()) {
  throw new Error(`Migration file ${fileName} is empty — refusing to run`);
}

async function main(): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl,
    // DDL + backfill can take a moment on a cold DB; give it room.
    statement_timeout: 180_000,
    connectionTimeoutMillis: 30_000,
  });

  const action = rollback ? "rollback" : "apply";
  console.log(`⏳ Campaigns (T151): ${action} → executing ${fileName}`);

  await client.connect();
  try {
    // The SQL file contains its own BEGIN/COMMIT. Sending the whole file as one
    // query string makes PostgreSQL treat it as a single implicit batch: on any
    // error the surrounding transaction is aborted and rolled back atomically.
    await client.query(sqlText);
    console.log(`✅ Campaigns (T151) ${action} completed successfully (${fileName}).`);
  } catch (err) {
    console.error(`❌ Campaigns (T151) ${action} FAILED — database left unchanged (transaction rolled back).`);
    console.error((err as Error).message);
    // Make the outer transaction abort explicit if the file didn't already.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
