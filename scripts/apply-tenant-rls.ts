/**
 * Apply (or roll back) the tenant Row-Level-Security migration atomically.
 *
 * Task #150 — installs the citefi_tenant role, citefi_rls helper schema,
 * SECURITY DEFINER validation helpers, grants and ENABLE + FORCE RLS policies
 * defined in migrations/0014_tenant_rls.sql.
 *
 * The SQL file wraps everything in its own BEGIN/COMMIT, so the entire script
 * is applied as a single atomic unit: if any statement fails, PostgreSQL rolls
 * the whole batch back and nothing is left half-installed. Both the migration
 * and the rollback are idempotent, so re-running is always safe.
 *
 * Uses the pg TCP driver (NOT the Neon HTTP driver) because the migration
 * contains multi-statement DO-blocks, SET ROLE and transaction control that the
 * HTTP driver cannot execute as one atomic batch.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx/esm scripts/apply-tenant-rls.ts
 *   node --env-file=.env.local --import tsx/esm scripts/apply-tenant-rls.ts --rollback
 *
 * Env:
 *   DATABASE_URL (required) — a direct (non-pooled) connection is preferred so
 *                             DDL and role changes take effect immediately.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

const databaseUrl = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL (or NEON_DATABASE_URL) must be set to apply the tenant RLS migration");
}

const rollback = process.argv.includes("--rollback");
const fileName = rollback ? "0014_tenant_rls_rollback.sql" : "0014_tenant_rls.sql";
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
    // DDL + role changes can take a moment on a cold DB; give it room.
    statement_timeout: 120_000,
    connectionTimeoutMillis: 30_000,
  });

  const action = rollback ? "rollback" : "apply";
  console.log(`⏳ Tenant RLS: ${action} → executing ${fileName}`);

  await client.connect();
  try {
    const roleCheck = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolsuper, rolbypassrls
         FROM pg_roles
        WHERE rolname = current_user`
    );
    const role = roleCheck.rows[0];
    if (!role || (!role.rolsuper && !role.rolbypassrls)) {
      throw new Error(
        "Tenant RLS requires the system login role to have BYPASSRLS; refusing a rollout that would lock maintenance paths out of forced-RLS tables"
      );
    }

    // The SQL file contains its own BEGIN/COMMIT. Sending the whole file as one
    // query string makes PostgreSQL treat it as a single implicit batch: on any
    // error the surrounding transaction is aborted and rolled back atomically.
    await client.query(sqlText);
    console.log(`✅ Tenant RLS ${action} completed successfully (${fileName}).`);
  } catch (err) {
    console.error(`❌ Tenant RLS ${action} FAILED — database left unchanged (transaction rolled back).`);
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
