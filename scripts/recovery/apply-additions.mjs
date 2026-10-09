import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
const [planPath, expectedHash, mode] = process.argv.slice(2);
const isolated = mode === "--isolated" && process.env.GITHUB_ACTIONS === "true";
const database = isolated ? "citefi_restore_verify" : "citefi";
const plan = fs.readFileSync(planPath, "utf8");
if (!/^[a-f0-9]{64}$/.test(expectedHash) ||
    crypto.createHash("sha256").update(plan).digest("hex") !== expectedHash) throw new Error("Plan checksum mismatch");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const refuse = code => { throw Object.assign(new Error("Recovery preflight refused"), { code }); };
try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='120s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('citefi-approved-additive-recovery'))");
  const { rows: [identity] } = await client.query(`SELECT current_database() AS database,
    NOT row_security_active('public.teams') AS full_visibility`);
  if (identity.database !== database || !identity.full_visibility) refuse("RECOVERY_WRONG_DATABASE_CONTEXT");
  // Never strand historical held money by creating an empty reservation table.
  const { rows: [holds] } = await client.query("SELECT count(*)::int AS count FROM credit_balances WHERE reserved_credits <> 0");
  if (holds.count) refuse("RECOVERY_LEGACY_HOLDS_REQUIRE_REVIEW");
  const tables = [...plan.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m => m[1]);
  for (const table of tables) {
    const { rows: [existing] } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", ["public." + table]);
    if (existing.present) refuse("RECOVERY_SCHEMA_CHANGED");
  }
  await client.query(plan);
  const { rows: [security] } = await client.query(`SELECT count(*)::int AS count FROM pg_class
    WHERE oid IN ('public.credit_reservations'::regclass,'public.provider_attempt_receipts'::regclass)
    AND relrowsecurity AND relforcerowsecurity`);
  if (security.count !== 2) refuse("RECOVERY_TENANT_CONTROLS_MISSING");
  await client.query("COMMIT");
  console.log(JSON.stringify({ additiveRecoveryApplied: true, sha256: expectedHash, database }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  // Driver text can contain connection/customer data; fixed messages only.
  console.error("Additive recovery refused or rolled back; diagnostic code:", error.code || "PREFLIGHT");
  process.exitCode = 1;
} finally { await client.end(); }
