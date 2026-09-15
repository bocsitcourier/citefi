import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";

// Read-only observation of the explicitly isolated live-provider QA tenant.
// Never print connection details or arbitrary provider error messages.
const session = JSON.parse(await readFile("reports/live-generation/session.json", "utf8"));
const budgetExposure = JSON.parse(await readFile("reports/live-generation/budget-exposure.json", "utf8"));
if (!session.isolation?.developmentOnly || !session.isolation?.syntheticIdentity) {
  throw new Error("An isolated development fixture is required");
}
const teamId = Number(session.team.teamId);
if (!Number.isSafeInteger(teamId) || teamId <= 0) throw new Error("Invalid fixture team");
const sharedCapUsd = 50;
const unresolvedReserveUsd = Number(budgetExposure.separateUnreconciledCallReserve?.reservedUsd);
if (!Number.isFinite(unresolvedReserveUsd) || unresolvedReserveUsd <= 0) {
  throw new Error("A positive unresolved reserve is required for the shared-cap gate");
}
const reservePolicy = budgetExposure.reservePolicy ?? {};
const singleCallModelLimitBoundUsd = Number(reservePolicy.singleCallStressBoundUsd);
const conditionalCombinedModelLimitBoundUsd = Number(reservePolicy.conditionalCombinedStressUpperBoundUsd);
const modelLimitBoundConfirmed =
  reservePolicy.combinedBoundConfirmed === true ||
  reservePolicy.combinedBoundStatus === "CONFIRMED_BY_HARNESS";
const modelLimitBoundStatus = String(
  reservePolicy.combinedBoundStatus ?? "UNRESOLVED — reserve policy evidence is missing",
);
const teamIds = [teamId];
const teamScopes: Array<{
  teamId: number;
  fixtureRole: string;
  approvedBudgetUsd: number | null;
  billingPlan?: string | null;
}> = [{
  teamId,
  fixtureRole: "primary",
  approvedBudgetUsd: sharedCapUsd,
}];
try {
  const additional = JSON.parse(await readFile("reports/live-generation/additional-fixtures.json", "utf8"));
  if (!additional.isolation?.developmentOnly || !additional.isolation?.syntheticIdentity) {
    throw new Error("Additional fixtures must be isolated development identities");
  }
  for (const [fixtureRole, fixture] of [["agency", additional.agency], ["client", additional.client]] as const) {
    const id = Number(fixture?.teamId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid additional fixture team");
    if (!teamIds.includes(id)) teamIds.push(id);
    const monthlyCapCents = Number(additional.accounting?.monthlyCapCents);
    teamScopes.push({
      teamId: id,
      fixtureRole,
      approvedBudgetUsd: fixtureRole === "agency" && Number.isFinite(monthlyCapCents)
        ? monthlyCapCents / 100
        : null,
      billingPlan: fixture?.billingPlan ?? null,
    });
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const client = new Client({
  connectionString: process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
});
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const providers = await client.query(`
    SELECT id, team_id, source_event_id, run_id, job_id, content_id, operation_type,
           provider, model, unit_type, input_units, output_units, unit_count,
           cost_microusd, provider_rate_id, provider_request_id, occurred_at
    FROM provider_usage_ledger WHERE team_id=ANY($1::int[]) ORDER BY id
  `, [teamIds]);
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
  const recordedProviderCostUsd = costMicrousd / 1_000_000;
  const actualRemainingUsd = sharedCapUsd - recordedProviderCostUsd;
  const conservativeExposureRemainingUsd =
    sharedCapUsd - recordedProviderCostUsd - unresolvedReserveUsd;
  const pauseThresholdUsd = sharedCapUsd - unresolvedReserveUsd;
  const pauseReasons = [
    ...(unpricedEvents ? ["unpriced provider usage"] : []),
    ...(costMicrousd + Math.round(unresolvedReserveUsd * 1_000_000) >= sharedCapUsd * 1_000_000
      ? ["recorded all-team cost plus unresolved reserve reaches the shared cap"]
      : []),
    ...(!modelLimitBoundConfirmed
      ? ["combined model-limit bound for both unresolved calls is not confirmed by the harness"]
      : []),
  ];
  const report = {
    observedAt: new Date().toISOString(),
    executionState: "BLOCKED / NOT CERTIFIED",
    completeSuccess: false,
    teamId,
    teamIds,
    teamScopes,
    approvedBudgetUsd: sharedCapUsd,
    sharedCapUsd,
    unresolvedReserveUsd,
    unresolvedIncidents: reservePolicy.incidents ?? [],
    singleCallModelLimitBoundUsd,
    conditionalCombinedModelLimitBoundUsd,
    modelLimitBoundConfirmed,
    modelLimitBoundStatus,
    reserveCoverage: modelLimitBoundConfirmed &&
      Number.isFinite(conditionalCombinedModelLimitBoundUsd) &&
      conditionalCombinedModelLimitBoundUsd <= unresolvedReserveUsd
      ? "COVERED_BY_DOCUMENTED_COMBINED_MODEL_LIMIT_BOUND"
      : "UNRESOLVED_BOUND_NOT_CONFIRMED_PAUSE_REQUIRED",
    pricedVerificationV2: reservePolicy.pricedVerificationV2 ?? null,
    recordedProviderCostUsd,
    actualRemainingUsd,
    conservativeExposureRemainingUsd,
    pauseThresholdUsd,
    pauseGate: {
      includesUnresolvedReserve: true,
      shouldPause: pauseReasons.length > 0,
      reasons: pauseReasons,
    },
    unpricedEvents,
    providerEventCount: providers.rowCount,
    note: "The shared $50 cap applies to recorded provider usage across all listed isolated QA teams plus the separate $6 reserve for two distinct unresolved calls. Balances and reservations below are for the primary team. The reserve is not a fabricated provider-ledger event. The priced verification-v2 row is counted once from the ledger and is not added again. If the combined model-limit bound is not harness-confirmed, the paid-call gate remains paused. Locked-rate usage valuation, not a provider invoice. Unpriced usage is not free.",
    balance: balance.rows[0], reservations: reservations.rows,
    creditEvents: credits.rows, batches: batches.rows, articles: articles.rows,
    providerEvents: providers.rows,
  };
  await writeFile("reports/live-generation/accounting.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ...report, providerEvents: undefined, creditEvents: undefined,
    note: report.note,
  }, null, 2));
  if (pauseReasons.length > 0) {
    console.error("PAUSE new paid submissions: shared-cap exposure gate reached or usage is unpriced.");
    process.exitCode = 2;
  }
} catch (error) {
  console.error("Live observation failed", (error as { code?: string }).code ?? "UNKNOWN");
  process.exitCode = 1;
} finally {
  await client.end();
}