import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const REPORT_DIR = join(process.cwd(), "reports", "live-generation");
const INVENTORY_PATH = join(REPORT_DIR, "masterinventory.json");
const SESSION_PATH = join(REPORT_DIR, "session.json");
const ACCOUNTING_PATH = join(REPORT_DIR, "accounting.json");
const BUDGET_EXPOSURE_PATH = join(REPORT_DIR, "budget-exposure.json");
const OUTPUT_PATH = join(REPORT_DIR, "dashboard.html");
const SUMMARY_PATH = join(REPORT_DIR, "execution-summary.md");

const REQUIRED_FIELDS = [
  "feature",
  "ui",
  "api",
  "provider",
  "generation",
  "output",
  "storage",
  "db",
  "export",
  "billing",
  "status",
  "evidence",
  "blocker",
  "nextProcedure",
] as const;
const ALLOWED_STATUSES = new Set([
  "NOT_RUN",
  "RUNNING",
  "PASS",
  "FAIL",
  "PARTIAL",
  "BLOCKED",
  "NOT_TESTABLE",
]);
const DIMENSION_FIELDS = [
  "ui",
  "api",
  "provider",
  "generation",
  "output",
  "storage",
  "db",
  "export",
  "billing",
] as const;
type DimensionField = (typeof DIMENSION_FIELDS)[number];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function display(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => escapeHtml(item)).join("<br>") : "—";
  }
  if (isRecord(value)) return escapeHtml(JSON.stringify(value));
  return value === null || value === undefined || value === "" ? "—" : escapeHtml(value);
}

async function readJson(path: string, required = true): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!required && isRecord(error) && (error as { code?: string }).code === "ENOENT") return null;
    throw new Error(`Cannot read valid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateInventory(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error("masterinventory.json must contain an array");
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Inventory entry ${index} must be an object`);
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) throw new Error(`Inventory entry ${index} is missing ${field}`);
    }
    if (!ALLOWED_STATUSES.has(String(entry.status))) {
      throw new Error(`Inventory entry ${index} has unsupported initial status ${String(entry.status)}`);
    }
    return entry;
  });
}

const REDACTED_KEYS = /(?:secret|password|token|credential|cookie|authorization|email|identity|loginHandle|providerRequestId|userPublicId|teamPublicId|batchPublicId)/i;

function sanitizeArtifact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeArtifact);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !REDACTED_KEYS.test(key))
      .map(([key, child]) => [key, sanitizeArtifact(child)]),
  );
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function money(value: number | null): string {
  return value === null ? "NOT REPORTED" : `$${value.toFixed(6)}`;
}

const inventory = validateInventory(await readJson(INVENTORY_PATH));
const session = await readJson(SESSION_PATH);
const accounting = await readJson(ACCOUNTING_PATH, false);
const budgetExposure = await readJson(BUDGET_EXPOSURE_PATH, false);
const sessionRecord = isRecord(session) ? session : {};
const sessionAccounting = isRecord(sessionRecord.accounting) ? sessionRecord.accounting : {};
const accountingRecord = isRecord(accounting) ? accounting : {};
const budgetExposureRecord = isRecord(budgetExposure) ? budgetExposure : {};

const budgetUsd =
  numberOrNull(accountingRecord.sharedCapUsd) ??
  numberOrNull(accountingRecord.approvedBudgetUsd) ??
  numberOrNull(sessionAccounting.monthlyCapUsd) ??
  50;
const rawProviderEvents = Array.isArray(accountingRecord.providerEvents)
  ? accountingRecord.providerEvents.filter(isRecord)
  : [];
const seenProviderLedgerIds = new Set<string>();
const providerEvents = rawProviderEvents.filter((event) => {
  const id = event.id ?? event.source_event_id;
  const key = id === undefined ? JSON.stringify(event) : String(id);
  if (seenProviderLedgerIds.has(key)) return false;
  seenProviderLedgerIds.add(key);
  return true;
});
const pricedProviderEvents = providerEvents
  .map((event) => Number(event.cost_microusd))
  .filter((cost) => Number.isFinite(cost));
const recordedCostUsd = pricedProviderEvents.length
  ? pricedProviderEvents.reduce((total, cost) => total + cost, 0) / 1_000_000
  : numberOrNull(accountingRecord.recordedProviderCostUsd);
const unpricedEvents = providerEvents.filter((event) => !Number.isFinite(Number(event.cost_microusd))).length;
const providerEventCount = providerEvents.length || numberOrNull(accountingRecord.providerEventCount);
const teamScopes = Array.isArray(accountingRecord.teamScopes)
  ? accountingRecord.teamScopes.filter(isRecord)
  : [];
const reserveRecord = isRecord(budgetExposureRecord.separateUnreconciledCallReserve)
  ? budgetExposureRecord.separateUnreconciledCallReserve
  : {};
const unrecordedReserveUsd = numberOrNull(reserveRecord.reservedUsd) ?? 6;
const reservePolicyRecord = isRecord(budgetExposureRecord.reservePolicy)
  ? budgetExposureRecord.reservePolicy
  : {};
const singleCallModelLimitBoundUsd = numberOrNull(reservePolicyRecord.singleCallStressBoundUsd);
const conditionalCombinedModelLimitBoundUsd =
  numberOrNull(reservePolicyRecord.conditionalCombinedStressUpperBoundUsd);
const modelLimitBoundStatus = String(
  accountingRecord.modelLimitBoundStatus ??
  reservePolicyRecord.combinedBoundStatus ??
  "UNRESOLVED — reserve policy evidence is missing",
).replace(/[.]+$/, "");
const modelLimitBoundConfirmed =
  accountingRecord.modelLimitBoundConfirmed === true ||
  modelLimitBoundStatus === "CONFIRMED_BY_HARNESS";
const actualRemainingUsd = recordedCostUsd === null ? null : budgetUsd - recordedCostUsd;
const conservativeExposureRemainingUsd = recordedCostUsd === null
  ? null
  : budgetUsd - recordedCostUsd - unrecordedReserveUsd;
const pauseThresholdUsd = budgetUsd - unrecordedReserveUsd;
const reserveCoverage = modelLimitBoundConfirmed &&
  conditionalCombinedModelLimitBoundUsd !== null &&
  conditionalCombinedModelLimitBoundUsd <= unrecordedReserveUsd
  ? "COVERED_BY_DOCUMENTED_COMBINED_MODEL_LIMIT_BOUND"
  : "UNRESOLVED_BOUND_NOT_CONFIRMED_PAUSE_REQUIRED";
const pauseGateRecord = isRecord(accountingRecord.pauseGate) ? accountingRecord.pauseGate : {};
const paidCallGate = pauseGateRecord.shouldPause === true || !modelLimitBoundConfirmed
const primaryTeamId = numberOrNull(accountingRecord.teamId);
const costCoverage = accounting
  ? "PARTIAL — unique provider-ledger valuation, not a provider invoice; unsupported, delayed, missing, or unpriced usage is not free."
  : "NOT REPORTED — accounting artifact is absent; no zero-cost inference is allowed.";
const providerEventRows = providerEvents.length
  ? providerEvents.map((event) => `<tr>
      <td>${display(event.occurred_at)}</td>
      <td>${display(event.operation_type)}</td>
      <td>${display(event.provider)}</td>
      <td>${display(event.model)}</td>
      <td>${display(event.unit_type)}</td>
      <td>${display(event.input_units)}</td>
      <td>${display(event.output_units)}</td>
      <td>${display(event.unit_count)}</td>
      <td>${typeof event.cost_microusd === "string" || typeof event.cost_microusd === "number"
        ? money(Number(event.cost_microusd) / 1_000_000)
        : "UNSUPPORTED / NOT RECORDED"}</td>
    </tr>`).join("")
  : `<tr><td colspan="9">No provider event rows are present in accounting.json. This is not proof of zero usage.</td></tr>`;

const artifactNames = (await readdir(REPORT_DIR))
  .filter((name) => name.endsWith("-run.json"))
  .sort();
const artifacts = await Promise.all(
  artifactNames.map(async (name) => ({
    name,
    value: sanitizeArtifact(await readJson(join(REPORT_DIR, name))),
  })),
);

function dimensionStatus(entry: JsonRecord, field: DimensionField): string {
  const overall = String(entry.status);
  const evidence = Array.isArray(entry.evidence) ? entry.evidence.join(" ") : String(entry.evidence ?? "");
  if (overall === "NOT_RUN") return "NOT_RUN";
  if (overall === "BLOCKED") {
    return field === "api" || field === "generation" ? "BLOCKED" : "NOT_RUN";
  }
  if (entry.feature === "Article title pool and topic research" &&
      evidence.includes("title-pool-readback-run.json")) {
    if (field === "api" || field === "storage" || field === "db") return "PASS";
    if (field === "ui") return "PARTIAL";
  }
  if (entry.feature === "Podcast generation" &&
      evidence.includes("existing-media-ui-run.json")) {
    if (field === "ui" || field === "export") return "PASS";
    if (field === "output" || field === "generation") return "FAIL";
  }
  if (entry.feature === "Campaign ad copy generation" &&
      evidence.includes("remaining-nonpaid-retest-run.json") &&
      field === "export") {
    return "FAIL";
  }
  if (entry.feature === "Agency report rendering and delivery" &&
      evidence.includes("remaining-nonpaid-retest-run.json")) {
    if (field === "api" || field === "generation" || field === "output" || field === "export") return "PASS";
    if (field === "provider" || field === "billing") return "PASS";
  }
  if (field === "ui" && /UI_NOT_TESTED|UI was not tested|UI was not tested/i.test(evidence)) {
    return "NOT_RUN";
  }
  if (field === "export" && /export (?:request )?(?:returned|failed)|export route|no successful export/i.test(evidence)) {
    return "FAIL";
  }
  if (field === "billing" && /unreconciled|cap-settlement caveat|settlement.*incomplete/i.test(evidence)) {
    return "PARTIAL";
  }
  return overall;
}

function dimensionCell(entry: JsonRecord, field: DimensionField): string {
  const status = dimensionStatus(entry, field);
  return `<span class="dimension-status ${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span><br>${display(entry[field])}`;
}

const inventoryRows = inventory.map((entry) => `
  <tr>
    <td><strong>${display(entry.feature)}</strong></td>
    <td>${dimensionCell(entry, "ui")}</td>
    <td>${dimensionCell(entry, "api")}</td>
    <td>${dimensionCell(entry, "provider")}</td>
    <td>${dimensionCell(entry, "generation")}</td>
    <td>${dimensionCell(entry, "output")}</td>
    <td>${dimensionCell(entry, "storage")}</td>
    <td>${dimensionCell(entry, "db")}</td>
    <td>${dimensionCell(entry, "export")}</td>
    <td>${dimensionCell(entry, "billing")}</td>
    <td><span class="status ${escapeHtml(String(entry.status).toLowerCase())}">${display(entry.status)}</span></td>
    <td>${display(entry.evidence)}</td>
    <td>${display(entry.blocker)}</td>
    <td>${display(entry.nextProcedure)}</td>
  </tr>`).join("");

const artifactCards = artifacts.length
  ? artifacts.map(({ name, value }) => {
      const record = isRecord(value) ? value : {};
      const isInitialArticlePrecondition =
        name === "article-run.json" &&
        record.status === "blocked" &&
        isRecord(record.network) &&
        record.network.providerCallsInitiated === false;
      const label = isInitialArticlePrecondition
        ? "PRECONDITION — EMPTY FIXTURE PAGE; NOT A PRODUCT BUG OR GENERATION RESULT"
        : String(record.status ?? "OUTCOME RECORDED");
      return `<article class="artifact">
        <h3>${escapeHtml(name)}</h3>
        <p><span class="status artifact-status">${escapeHtml(label)}</span></p>
        <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>
      </article>`;
    }).join("")
  : `<p class="muted">No outcome artifact JSON files are present yet.</p>`;

const generatedAt = new Date().toISOString();
const fixtureLabel = typeof sessionRecord.fixtureLabel === "string"
  ? sessionRecord.fixtureLabel
  : "Live generation session";
const statusCounts = inventory.reduce<Record<string, number>>((counts, entry) => {
  const status = String(entry.status);
  counts[status] = (counts[status] ?? 0) + 1;
  return counts;
}, {});
const matrixSummary = ["PASS", "PARTIAL", "FAIL", "BLOCKED", "NOT_RUN", "RUNNING", "NOT_TESTABLE"]
  .map((status) => `${status} ${statusCounts[status] ?? 0}`)
  .join(" · ");
const notRunEntries = inventory.filter((entry) => String(entry.status) === "NOT_RUN");
const notRunMarkdown = notRunEntries.length
  ? notRunEntries.map((entry, index) =>
      `${index + 1}. **${String(entry.feature)}** — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: ${String(entry.nextProcedure)}`).join("\n")
  : "None.";
const notRunHtml = notRunEntries.length
  ? `<ol>${notRunEntries.map((entry) =>
      `<li><strong>${display(entry.feature)}</strong> — RETAINED NOT_RUN; no operation is authorized in this finalization. Existing procedure note: ${display(entry.nextProcedure)}</li>`).join("")}</ol>`
  : "<p>None.</p>";
const teamScopeSummary = teamScopes.length
  ? teamScopes.map((scope) => {
      const cap = numberOrNull(scope.approvedBudgetUsd);
      return `${String(scope.teamId)} (${String(scope.fixtureRole ?? "fixture")}, cap ${cap === null ? "NOT REPORTED" : money(cap)})`;
    }).join("; ")
  : primaryTeamId === null ? "NOT REPORTED" : `${primaryTeamId} (primary, cap ${money(budgetUsd)})`;
const unresolvedIncidents = Array.isArray(accountingRecord.unresolvedIncidents)
  ? accountingRecord.unresolvedIncidents.filter(isRecord)
  : Array.isArray(reservePolicyRecord.incidents)
    ? reservePolicyRecord.incidents.filter(isRecord)
    : [];
const unresolvedIncidentMarkdown = unresolvedIncidents.length
  ? unresolvedIncidents.map((incident) =>
      `- **${String(incident.incidentKey ?? "UNNAMED")}:** ${String(incident.description ?? "Description not recorded.")} Model-limit confirmation: ${String(incident.modelLimitsConfirmedFromHarness ?? "NOT_RECORDED")}; ledger rows: ${String(incident.ledgerRows ?? "NOT_RECORDED")}.`).join("\n")
  : "- No separately identified unresolved call records are present.";
const unresolvedIncidentHtml = unresolvedIncidents.length
  ? `<ul>${unresolvedIncidents.map((incident) =>
      `<li><strong>${display(incident.incidentKey ?? "UNNAMED")}</strong>: ${display(incident.description ?? "Description not recorded.")} Model-limit confirmation: ${display(incident.modelLimitsConfirmedFromHarness ?? "NOT_RECORDED")}; ledger rows: ${display(incident.ledgerRows ?? "NOT_RECORDED")}.</li>`).join("")}</ul>`
  : "<p>No separately identified unresolved call records are present.</p>";
const productUnsupportedCount = inventory.filter(
  (entry) => entry.sourceClassification === "UNSUPPORTED",
).length;
const noPublishAuthorizationCount = inventory.filter(
  (entry) => entry.sourceClassification === "NO_PUBLISH_AUTHORIZATION",
).length;
const sourceBoundaryStatusCount = productUnsupportedCount + noPublishAuthorizationCount;
const runArtifactSummary = artifacts.map(({ name, value }) => {
  const record = isRecord(value) ? value : {};
  return `${name}: ${String(record.status ?? "OUTCOME_RECORDED")}`;
});
const finalState = "BLOCKED / NOT CERTIFIED";
const summaryMarkdown = `# Live generation execution summary

**Final execution state: ${finalState}. This record is not complete success and is not certified.**

Rendered: ${generatedAt}
Fixture: ${fixtureLabel}

## Matrix counts

${matrixSummary}
Total inventory rows: ${inventory.length} (the 40th row is standalone Brand Intelligence).
The dashboard matrix renders an explicit status beside each row's UI, API, Provider, Generation, Output, Storage, DB, Export, and Billing evidence; dimension status never upgrades an overall result.

## Accounting and budget

- Shared approved cap: ${money(budgetUsd)} (authorization ceiling only; not a provider invoice or a claim of available spend).
- Additional unreconciled reserve: ${money(unrecordedReserveUsd)} (unrecorded reserve; excluded from provider-ledger actuals and not treated as spend).
- Shared-cap observer scope: ${teamScopeSummary}. The $50 cap applies to recorded provider usage across all listed teams plus the separate unresolved reserve; it is not a primary-only remaining calculation.
- Unique provider ledger events rendered: ${providerEventCount ?? "NOT REPORTED"}.
- Actual recorded provider cost across observer scopes: ${money(recordedCostUsd)} from unique provider-ledger IDs in accounting.json; overlapping report totals are not added.
- Actual remaining before unresolved reserve: ${money(actualRemainingUsd)} (= shared cap − all-team recorded cost).
- Conservative exposure remaining after unresolved reserve: ${money(conservativeExposureRemainingUsd)} (= $50 − all-team recorded cost − ${money(unrecordedReserveUsd)} reserve). The reserve is not a fabricated ledger event.
- Reserve coverage: ${reserveCoverage}; single-call stress bound ${money(singleCallModelLimitBoundUsd)}, conditional two-call stress upper bound ${money(conditionalCombinedModelLimitBoundUsd)}, status: ${modelLimitBoundStatus}.
- Existing unresolved calls are identified separately (original article generation and first QA audio verification); the ${money(unrecordedReserveUsd)} reserve is the only coverage treatment, with no ledger event or expense estimate fabricated. The priced verification-v2 ledger row is counted once and not added again.
- QA observer gate: ${paidCallGate ? "PAUSED" : "open"} — pause new paid submissions when all-team recorded cost plus the unresolved reserve reaches the shared cap, whenever usage is unpriced, or until both unresolved-call model limits are confirmed by the harness.
- Cost coverage: ${costCoverage}

### Unresolved call identities

${unresolvedIncidentMarkdown}

## Final blockers and certification boundary

- **Paid-call gate:** PAUSED. The separate ${money(unrecordedReserveUsd)} reserve covers two identified unresolved physical calls without fabricating either expense; the conditional two-call stress bound is ${money(conditionalCombinedModelLimitBoundUsd)}, but the first QA audio verification model/limits are not harness-confirmed.
- **Pending paid retests:** article quality/terminal settlement, social constraint/cap settlement/UI, podcast duration/transcription recovery, video queue/Veo proof, and other provider-backed rows remain pending or failed; no paid retest was authorized or made in this continuation.
- **Source-proven non-execution classifications:** ${productUnsupportedCount} inventory rows are product-unsupported/NOT_TESTABLE absent contracts, and ${noPublishAuthorizationCount} separate row is NO_PUBLISH_AUTHORIZATION/NOT_RUN despite explicit source routes (${sourceBoundaryStatusCount} source-proven boundary statuses total); none is a failed execution.
- **Non-paid blockers:** title selection remains hidden by the RUNNING batch UI despite five persisted API titles; the existing podcast play/download passes but its duration failure remains; the immutable ad export's independent canonical hash FAIL remains preserved; agency report concurrency failed even though deterministic HTML generation/download passed.
- **Source-fix boundary:** migration 0033 and the canonical-date, queue-id, report-config, and related fixes are unit-verified/source-reviewed only, not live-certified. Migration 0033 was verified on the actual app database; an additive application was also observed on a separately configured Neon DSN without the QA team. No DSNs/secrets are rendered, no rows/data were deleted, and QA recurring automation remains disabled.
- **Certification decision:** BLOCKED / NOT CERTIFIED. The exact retained accounting is ${providerEventCount ?? "NOT REPORTED"} unique provider events and ${money(recordedCostUsd)} recorded provider-ledger cost across all three observer teams; the incorporated retests initiated zero provider calls.

## Current evidence decisions

- Standalone Brand Intelligence: PASS for the public HomeWorks Energy source. The separate controlled-runtime fixture failure remains preserved and is not overwritten.
- Article quality: FAIL for the latest terminal run; CHATGPT_REVIEWED ended failed and the 10-credit reservation was RELEASED. The historical retry with missing billing data remains a separate historical failure, not proof of a missing debit.
- Title pool: five persisted API titles are proven by authenticated readback; the already-RUNNING UI hides selection and remains UI-limited.
- Social: five physical provider-generated images and five READY variants are preserved; zero hero reuses were observed. X length/aspect/cap settlement defects keep the feature FAIL. Recorded actual social provider spend is $0.211397.
- Podcast: existing-media playback/download pass, but the real 204.384-second MP3 still fails the requested 1–2 minute contract; transcription output is incomplete and its $0.001730 metered cost is not zero.
- Video: two failed attempts have queue/Gemini evidence but no Veo operation or asset; the latest script fix is not live-proven, so the row remains FAIL.
- SEO schema UI retest: four valid deterministic UI schemas (FAQPage, Article, HowTo, LocalBusiness), with no provider calls; this narrow schema UI row is PASS.
- Ad export: downloaded export and internal hashes pass, while independent canonical round-trip verification FAIL remains preserved; the future Date fix was unit-tested and the historical artifact was not rewritten.
- Agency report: deterministic HTML report generated/approved/downloaded with no provider call; the concurrent report suite failed and is retained as a blocker.
- Human-authored fixture article 2238 is input only and never counts as an AI article pass.
- Public-report credential audit: password, preview-token, credential-path, and auth-payload fields were removed from saved report artifacts; only non-secret auth outcome metadata remains, and private fixture credentials stay outside reports.

## Retained pending evidence (not a generic next-run plan)

The rows and blockers above are the complete boundary for this finalized record. No new paid operation, external publication, email, recurring QA job, source-data deletion, or placeholder output is authorized by this record. Unsupported source findings, no-publish authorization, and pending paid retests remain distinct classifications.

## Exact NOT_RUN allocation list (${notRunEntries.length} retained, no finalization authorization)

These rows are an exact allocation of missing evidence, not instructions to spend budget or publish. Each remains NOT_RUN because this finalization did not authorize its operation.

${notRunMarkdown}

## Run artifacts

${runArtifactSummary.map((line) => `- ${line}`).join("\n")}
`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live Generation Execution Dashboard</title>
  <style>
    :root { color-scheme: dark; --bg:#08111f; --panel:#111d2f; --line:#2a3b55; --text:#e9f0f8; --muted:#9fb0c5; --accent:#65d6b4; --warn:#ffc857; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 system-ui,sans-serif; }
    header, main { max-width:1800px; margin:auto; padding:24px; }
    h1 { margin:0 0 6px; } h2 { margin-top:32px; }
    .muted { color:var(--muted); }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:12px; }
    .card,.artifact { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
    .value { font-size:1.5rem; font-weight:750; margin-top:5px; }
    .coverage { border-left:4px solid var(--warn); }
    .table-wrap { overflow:auto; border:1px solid var(--line); border-radius:10px; }
    table { border-collapse:collapse; min-width:2600px; background:var(--panel); }
    th,td { border-bottom:1px solid var(--line); border-right:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; max-width:280px; }
    th { position:sticky; top:0; background:#17263b; z-index:1; }
     .status,.dimension-status { display:inline-block; padding:3px 8px; border-radius:999px; background:#293b55; font-weight:700; white-space:normal; }
     .dimension-status { padding:1px 5px; font-size:11px; letter-spacing:.02em; }
     .not_run { color:var(--warn); } .not_testable,.blocked { color:#ff8e8e; }
    .artifacts { display:grid; gap:12px; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; color:#cfe0f4; }
    code { color:var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>Live Generation Execution Dashboard</h1>
    <div class="muted">${escapeHtml(fixtureLabel)} · rendered ${escapeHtml(generatedAt)}</div>
    <p><span class="status blocked">${finalState}</span> This dashboard is not complete success and is not certified.</p>
    <p>This dashboard reports real-session artifacts without converting static inventory, a reachable port, an empty fixture page, or missing evidence into PASS. Source-proven unsupported rows are <strong>NOT_TESTABLE</strong>; pending paid retests and no-publish authorization remain separate <strong>NOT_RUN</strong>/<strong>BLOCKED</strong> evidence.</p>
    <p class="muted">Public-report credential audit completed: password, preview-token, credential-path, and auth-payload fields are omitted. Private fixture credentials are not rendered.</p>
  </header>
  <main>
    <section class="cards" aria-label="Budget and accounting">
      <div class="card"><div class="muted">Funded hard budget</div><div class="value">${money(budgetUsd)}</div></div>
      <div class="card"><div class="muted">Recorded provider cost (all scopes)</div><div class="value">${money(recordedCostUsd)}</div></div>
      <div class="card"><div class="muted">Actual remaining before reserve</div><div class="value">${money(actualRemainingUsd)}</div><div class="muted">Shared cap minus all-team recorded cost.</div></div>
      <div class="card coverage"><div class="muted">Conservative exposure remaining</div><div class="value">${money(conservativeExposureRemainingUsd)}</div><div class="muted">Shared cap minus all-team actuals and ${money(unrecordedReserveUsd)} unresolved reserve.</div></div>
      <div class="card"><div class="muted">Recorded provider events (all scopes)</div><div class="value">${providerEventCount ?? "NOT REPORTED"}</div></div>
      <div class="card"><div class="muted">Unpriced events</div><div class="value">${unpricedEvents ?? "NOT REPORTED"}</div></div>
      <div class="card coverage"><div class="muted">Unrecorded reserve</div><div class="value">${money(unrecordedReserveUsd)}</div><div class="muted">Separate reserve; not added to actual spend. ${escapeHtml(reserveCoverage)}; single-call bound ${money(singleCallModelLimitBoundUsd)}, conditional combined bound ${money(conditionalCombinedModelLimitBoundUsd)}.</div></div>
      <div class="card coverage"><div class="muted">Pause threshold for all-team actuals</div><div class="value">${money(pauseThresholdUsd)}</div><div class="muted">Pause when recorded all-team cost plus unresolved reserve reaches the shared cap.</div></div>
      <div class="card coverage"><div class="muted">Paid-call gate</div><div class="value">${paidCallGate ? "PAUSED" : "OPEN"}</div><div class="muted">Requires priced usage and harness-confirmed model limits for both unresolved calls.</div></div>
      <div class="card coverage"><div class="muted">Cost coverage</div><div>${escapeHtml(costCoverage)}</div></div>
    </section>

    <h2>Matrix counts</h2>
    <p class="muted">${escapeHtml(matrixSummary)} · ${inventory.length} inventory rows · final state ${escapeHtml(finalState)}.</p>

    <h2>Observed provider accounting</h2>
    <p class="muted">Source: <code>accounting.json</code>, observed ${display(accountingRecord.observedAt)}. Observer scope: ${escapeHtml(teamScopeSummary)}. Costs are consolidated by unique provider ledger ID across the primary, agency, and client fixtures against the shared $50 cap. Actual remaining is ${money(actualRemainingUsd)}; conservative exposure remaining is ${money(conservativeExposureRemainingUsd)} after the separate ${money(unrecordedReserveUsd)} unresolved reserve. Paid-call gate: ${paidCallGate ? "PAUSED" : "OPEN"} until cap exposure, unpriced usage, and model-limit verification conditions are clear. Request identifiers and sensitive fields are intentionally not rendered.</p>
    <div class="table-wrap">
      <table style="min-width:1100px">
        <thead><tr><th>occurred</th><th>operation</th><th>provider</th><th>model</th><th>unit type</th><th>input</th><th>output</th><th>unit count</th><th>recorded cost</th></tr></thead>
        <tbody>${providerEventRows}</tbody>
      </table>
    </div>
    <h3>Unresolved call identities and reserve treatment</h3>
    <p class="muted">The ${money(unrecordedReserveUsd)} reserve is exposure only, not a provider-ledger event or fabricated expense. The priced verification-v2 row is counted once from accounting and is not added again.</p>
    ${unresolvedIncidentHtml}

    <h2>Master execution inventory (${inventory.length})</h2>
    <div class="table-wrap">
       <table>
         <thead><tr><th>Feature</th>${DIMENSION_FIELDS.map((field) => `<th>${escapeHtml(field.toUpperCase())} status + evidence</th>`).join("")}<th>Overall status</th><th>Evidence</th><th>Blocker</th><th>Next procedure</th></tr></thead>
        <tbody>${inventoryRows}</tbody>
      </table>
    </div>

    <h2>Exact NOT_RUN allocation list (${notRunEntries.length})</h2>
    <p class="muted">These rows have no saved live outcome in this finalization. They remain NOT_RUN with no operation authorized; no unsupported row is relabeled NOT_TESTABLE without concrete source-proven blocking evidence.</p>
    ${notRunHtml}

    <h2>Final blockers and certification boundary</h2>
    <ul>
      <li><strong>Paid-call gate:</strong> PAUSED. The ${money(unrecordedReserveUsd)} reserve remains outside provider-ledger actuals; the conditional two-call stress bound is ${money(conditionalCombinedModelLimitBoundUsd)}, but the first QA audio verification model/limits are not harness-confirmed.</li>
      <li><strong>Non-paid evidence:</strong> five title strings are API-persisted while the RUNNING UI hides selection; existing podcast play/download pass while duration FAIL remains; ad export download exists while the independent canonical hash FAIL remains; deterministic agency HTML report download passed while concurrency failed.</li>
      <li><strong>Source-fix boundary:</strong> all listed source fixes are unit-verified/source-reviewed only, not live-certified. Migration 0033 is verified on the actual app database and was also additively applied to a separately configured Neon DSN without the QA team. No DSN/secret is rendered and no data deletion occurred; QA recurring automation is disabled.</li>
      <li><strong>Classification:</strong> ${productUnsupportedCount} NOT_TESTABLE/UNSUPPORTED rows are source-proven absent product contracts, while ${noPublishAuthorizationCount} Content publication row is separate NO_PUBLISH_AUTHORIZATION/NOT_RUN; provider-backed pending retests remain gated and are not unsupported (${sourceBoundaryStatusCount} source-proven boundary statuses total).</li>
      <li><strong>Decision:</strong> ${finalState}. Retained accounting is ${providerEventCount ?? "NOT REPORTED"} unique provider events and ${money(recordedCostUsd)} all-team recorded provider-ledger cost; incorporated retests initiated zero provider calls.</li>
    </ul>

    <h2>Actual outcome artifacts (${artifacts.length})</h2>
     <p class="muted">Only saved <code>*-run.json</code> artifacts are included. Artifacts are escaped before rendering and sensitive-key fields are omitted. Their recorded status is displayed as evidence, not promoted to PASS.</p>
    <div class="artifacts">${artifactCards}</div>
  </main>
</body>
</html>`;

await writeFile(OUTPUT_PATH, html, "utf8");
await writeFile(SUMMARY_PATH, summaryMarkdown, "utf8");
console.log(`Rendered ${basename(OUTPUT_PATH)} and ${basename(SUMMARY_PATH)} from ${inventory.length} inventory entries and ${artifacts.length} live run artifacts.`);