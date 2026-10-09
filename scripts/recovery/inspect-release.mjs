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
  const { rows: [holdReconstruction] } = await db.query(`WITH candidates AS (
    SELECT r.id,r.team_id,r.run_id,r.amount,
      COALESCE(SUM(CASE WHEN s.event_type IN ('debit','release') THEN abs(s.amount) ELSE 0 END),0) settled,
      count(*) OVER(PARTITION BY r.team_id,r.run_id) duplicate_count
    FROM credit_ledger r LEFT JOIN credit_ledger s ON s.team_id=r.team_id AND s.run_id=r.run_id
      AND s.event_type IN ('debit','release') WHERE r.event_type='reserve'
    GROUP BY r.id,r.team_id,r.run_id,r.amount
  ), eligible AS (
    SELECT * FROM candidates WHERE run_id IS NOT NULL AND duplicate_count=1 AND amount>0 AND settled<=amount
  ), totals AS (SELECT team_id,sum(amount-settled) remaining FROM eligible GROUP BY team_id)
  SELECT
    (SELECT count(*)::int FROM candidates WHERE run_id IS NULL OR duplicate_count<>1 OR amount<=0 OR settled>amount) AS ambiguous_reserve_records,
    (SELECT count(*)::int FROM eligible WHERE settled<amount) AS verified_outstanding_runs,
    (SELECT count(*)::int FROM eligible WHERE settled=amount) AS verified_settled_runs,
    (SELECT count(*)::int FROM credit_balances b LEFT JOIN totals t ON t.team_id=b.team_id
      WHERE COALESCE(t.remaining,0)<>b.reserved_credits) AS mismatched_balance_teams,
    (SELECT count(*)::int FROM totals t LEFT JOIN credit_balances b ON b.team_id=t.team_id
      WHERE b.team_id IS NULL AND t.remaining<>0) AS missing_balance_teams`);
  await db.query("ROLLBACK");
  console.log(JSON.stringify({ identity, requiredTables: rows, appliedMigrations: migrations, historicalHeldCreditTeams: holds.affected_team_count, holdReconstruction }));
} catch {
  console.error("Read-only release compatibility inspection failed.");
  process.exitCode = 1;
} finally { await db.end(); }
