// Read-only compatibility probe. No schema reconciliation or status fabrication.
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await db.connect();
  await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL statement_timeout='5s'");
  const { rows: [identity] } = await db.query(`SELECT current_database()='citefi' AS expected_database,
    NOT row_security_active('public.teams') AS full_team_visibility`);
  if (!identity.expected_database || !identity.full_team_visibility) throw new Error("Unexpected context");
  const required = ["provider_attempt_receipts", "provider_rate_versions", "provider_rates",
    "provider_usage_ledger", "provider_invoice_reconciliations", "stripe_credit_reconciliations",
    "citefi_schema_migrations"];
  const { rows } = await db.query("SELECT name,to_regclass('public.'||name) IS NOT NULL AS present FROM unnest($1::text[]) AS name", [required]);
  const registry = rows.find(row => row.name === "citefi_schema_migrations");
  const migrations = registry.present ? (await db.query("SELECT version,sha256 FROM citefi_schema_migrations ORDER BY version")).rows : [];
  const { rows: [holds] } = await db.query("SELECT count(*)::int AS affected_team_count FROM credit_balances WHERE reserved_credits <> 0");
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ identity, requiredTables: rows, appliedMigrations: migrations, historicalHeldCreditTeams: holds.affected_team_count }));
} catch {
  console.error("Read-only release compatibility inspection failed.");
  process.exitCode = 1;
} finally { await db.end(); }
