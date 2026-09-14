import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";

// Read-only observation of the explicitly isolated live-provider QA tenant.
// Never print connection details or arbitrary provider error messages.
const session = JSON.parse(await readFile("reports/live-generation/session.json", "utf8"));
if (!session.isolation?.developmentOnly || !session.isolation?.syntheticIdentity) {
  throw new Error("An isolated development fixture is required");
}
const teamId = Number(session.team.teamId);
if (!Number.isSafeInteger(teamId) || teamId <= 0) throw new Error("Invalid fixture team");
const client = new Client({
  connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const providers = await client.query(`
    SELECT id, source_event_id, run_id, job_id, content_id, operation_type,
           provider, model, unit_type, input_units, output_units, unit_count,
           cost_microusd, provider_rate_id, provider_request_id, occurred_at
    FROM provider_usage_ledger WHERE team_id=$1 ORDER BY id
  `, [teamId]);
  const balance = await client.query(`
    SELECT balance, allowance_credits, purchased_credits, allowance_used,
           purchased_used, reserved_credits FROM credit_balances WHERE team_id=$1
  `, [teamId]);
  const reservations = await client.query(`
    SELECT id, run_id, operation_type, original_amount, remaining_amount,
           status, reconciliation_required_at, created_at, updated_at
    FROM credit_reservations WHERE team_id=$1 ORDER BY id
  `, [teamId]);
  const credits = await client.query(`
    SELECT id, event_type, amount, run_id, operation_type, job_id, created_at
    FROM credit_ledger WHERE team_id=$1 ORDER BY id
  `, [teamId]);
  const batches = await client.query(`
    SELECT id, status, created_at FROM job_batches WHERE team_id=$1 ORDER BY id
  `, [teamId]);
  const articles = await client.query(`
    SELECT id, batch_id, chosen_title, article_status,
           hero_image_url IS NOT NULL AS has_hero_image,
           length(final_html_content) AS text_length
    FROM articles WHERE team_id=$1 ORDER BY id
  `, [teamId]);
  await client.query("COMMIT");
  const costMicrousd = providers.rows.reduce((sum, row) => sum + Number(row.cost_microusd), 0);
  const unpricedEvents = providers.rows.filter(row => !row.provider_rate_id).length;
  const report = {
    observedAt: new Date().toISOString(), teamId, approvedBudgetUsd: 50,
    recordedProviderCostUsd: costMicrousd / 1_000_000,
    unpricedEvents, providerEventCount: providers.rowCount,
    note: "Locked-rate usage valuation, not a provider invoice. Unpriced usage is not free.",
    balance: balance.rows[0], reservations: reservations.rows,
    creditEvents: credits.rows, batches: batches.rows, articles: articles.rows,
    providerEvents: providers.rows,
  };
  await writeFile("reports/live-generation/accounting.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report, providerEvents: undefined, creditEvents: undefined,
    note: report.note,
  }, null, 2));
  if (unpricedEvents || costMicrousd >= 45_000_000) {
    console.error("PAUSE new paid submissions: unpriced usage or budget safety margin reached.");
    process.exitCode = 2;
  }
} catch (error) {
  console.error("Live observation failed", (error as { code?: string }).code ?? "UNKNOWN");
  process.exitCode = 1;
} finally {
  await client.end();
}