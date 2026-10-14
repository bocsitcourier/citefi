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
  // Block legacy writers during reconstruction; no financial row may change.
  await client.query("LOCK TABLE credit_balances,credit_ledger IN SHARE ROW EXCLUSIVE MODE");
  const fingerprint = async () => (await client.query(`SELECT
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(b)-'allowance_debt'-'purchased_debt' ORDER BY team_id)::text,'')) FROM credit_balances b) balances,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(l)-'reversed_credits'-'stripe_checkout_session_id'-'stripe_payment_intent_id'-'stripe_invoice_id' ORDER BY id)::text,'')) FROM credit_ledger l) ledger`)).rows[0];
  const before = await fingerprint();
  await client.query(`CREATE TEMP TABLE recovery_verified_legacy_holds ON COMMIT DROP AS
    SELECT r.id,r.team_id,r.run_id,COALESCE(r.operation_type,r.product_type,'legacy') operation_type,
      r.amount,r.created_at,
      COALESCE(SUM(CASE WHEN s.event_type IN ('debit','release') THEN abs(s.amount) ELSE 0 END),0) settled,
      count(*) OVER(PARTITION BY r.team_id,r.run_id) duplicate_count
    FROM credit_ledger r LEFT JOIN credit_ledger s ON s.team_id=r.team_id AND s.run_id=r.run_id
      AND s.event_type IN ('debit','release') WHERE r.event_type='reserve'
    GROUP BY r.id,r.team_id,r.run_id,r.operation_type,r.product_type,r.amount,r.created_at`);
  const {rows:[legacy]} = await client.query(`SELECT
    (SELECT count(*)::int FROM recovery_verified_legacy_holds
      WHERE run_id IS NULL OR btrim(run_id)='' OR duplicate_count<>1 OR amount<=0 OR settled>amount) ambiguous,
    (SELECT count(*)::int FROM recovery_verified_legacy_holds WHERE amount>settled) outstanding,
    (SELECT count(*)::int FROM credit_balances b FULL JOIN
      (SELECT team_id,sum(amount-settled) remaining FROM recovery_verified_legacy_holds GROUP BY team_id) t
      ON b.team_id=t.team_id WHERE COALESCE(t.remaining,0)<>COALESCE(b.reserved_credits,0)) mismatched`);
  if (legacy.ambiguous || legacy.mismatched) refuse("RECOVERY_LEGACY_HOLDS_NOT_EXPLAINED");
  if (legacy.outstanding !== 1 || process.env.PROTECT_LEGACY_HOLD !== "true") refuse("RECOVERY_LEGACY_HOLDS_REQUIRE_REVIEW");
  const tables = [...plan.matchAll(/CREATE TABLE "([^"]+)"/g)].map(m => m[1]);
  for (const table of tables) {
    const { rows: [existing] } = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", ["public." + table]);
    if (existing.present) refuse("RECOVERY_SCHEMA_CHANGED");
  }
  await client.query(plan);
  const {rows:[adoption]} = await client.query(`SELECT
    (SELECT count(*)::int FROM credit_balances b FULL JOIN
      (SELECT team_id,sum(remaining_amount) remaining FROM credit_reservations WHERE status='RESERVED' GROUP BY team_id) r
      ON b.team_id=r.team_id WHERE COALESCE(r.remaining,0)<>COALESCE(b.reserved_credits,0)) mismatched,
    (SELECT count(*)::int FROM credit_reservations WHERE status='RESERVED'
      AND reconciliation_required_at IS NOT NULL AND reconciliation_reason IS NOT NULL) protected`);
  if (adoption.mismatched || adoption.protected !== 1 ||
      JSON.stringify(before) !== JSON.stringify(await fingerprint())) refuse("RECOVERY_FINANCIAL_PRESERVATION_FAILED");
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
