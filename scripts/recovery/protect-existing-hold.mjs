// Owner-approved financial metadata only: never change a balance or ledger row.
import pg from "pg";
const isolated=process.argv.includes("--isolated")&&process.env.GITHUB_ACTIONS==="true";
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const refuse=code=>{throw Object.assign(new Error("Protected hold preflight refused"),{code});};
try {
  if(process.env.PROTECT_LEGACY_HOLD!=="true") refuse("APPROVAL_REQUIRED");
  await client.connect();
  await client.query("BEGIN; SET LOCAL lock_timeout='10s'; SET LOCAL statement_timeout='30s'");
  const {rows:[identity]}=await client.query("SELECT current_database() name, NOT row_security_active('public.credit_balances') visible");
  if(identity.name!==(isolated?"citefi_restore_verify":"citefi")||!identity.visible) refuse("WRONG_DATABASE_CONTEXT");
  await client.query("LOCK TABLE credit_balances,credit_ledger,credit_reservations IN SHARE ROW EXCLUSIVE MODE");
  const fingerprint=async()=>(await client.query(`SELECT
    (SELECT md5(jsonb_agg(to_jsonb(b) ORDER BY team_id)::text) FROM credit_balances b) balances,
    (SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY id)::text) FROM credit_ledger l) ledger`)).rows[0];
  const before=await fingerprint();
  await client.query(`CREATE TEMP TABLE verified_hold ON COMMIT DROP AS
    SELECT r.team_id,r.run_id,r.amount,
      COALESCE(SUM(abs(s.amount)),0) settled,
      count(*) OVER(PARTITION BY r.team_id,r.run_id) duplicates
    FROM credit_ledger r LEFT JOIN credit_ledger s ON s.team_id=r.team_id AND s.run_id=r.run_id
      AND s.event_type IN ('debit','release') WHERE r.event_type='reserve'
    GROUP BY r.id,r.team_id,r.run_id,r.amount`);
  const {rows:[proof]}=await client.query(`SELECT
    (SELECT count(*)::int FROM verified_hold WHERE run_id IS NULL OR btrim(run_id)='' OR duplicates<>1 OR amount<=0 OR settled>amount) ambiguous,
    (SELECT count(*)::int FROM verified_hold WHERE amount>settled) outstanding,
    (SELECT count(*)::int FROM credit_balances b FULL JOIN
      (SELECT team_id,sum(amount-settled) remaining FROM verified_hold GROUP BY team_id) h ON h.team_id=b.team_id
      WHERE COALESCE(h.remaining,0)<>COALESCE(b.reserved_credits,0)) mismatched,
    (SELECT count(*)::int FROM credit_reservations WHERE status='RESERVED') active,
    (SELECT count(*)::int FROM credit_reservations r JOIN verified_hold h USING(team_id,run_id)
      WHERE r.status='RESERVED' AND h.amount>h.settled AND r.original_amount=h.amount
      AND r.remaining_amount=h.amount-h.settled) matching`);
  if(proof.ambiguous||proof.mismatched||proof.outstanding!==1||proof.active!==1||proof.matching!==1) refuse("HOLD_NOT_EXACTLY_VERIFIED");
  await client.query(`UPDATE credit_reservations SET
    reconciliation_required_at=COALESCE(reconciliation_required_at,now()),
    reconciliation_reason=COALESCE(reconciliation_reason,'Inherited ledger-verified hold; explicit outcome reconciliation required before refund')
    WHERE status='RESERVED'`);
  if(JSON.stringify(before)!==JSON.stringify(await fingerprint())) refuse("FINANCIAL_ROWS_CHANGED");
  await client.query("COMMIT");
  console.log(JSON.stringify({verifiedHoldProtected:true,balancesUnchanged:true,ledgerUnchanged:true,isolated}));
} catch(error) {
  await client.query("ROLLBACK").catch(()=>{});
  console.error("Protected hold refused or rolled back:",error.code||"PREFLIGHT");
  process.exitCode=1;
} finally {await client.end();}
