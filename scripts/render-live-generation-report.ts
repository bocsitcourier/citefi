import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const REPORT_DIR = join(process.cwd(), "reports", "live-generation");
const INVENTORY_PATH = join(REPORT_DIR, "masterinventory.json");
const SESSION_PATH = join(REPORT_DIR, "session.json");
const ACCOUNTING_PATH = join(REPORT_DIR, "accounting.json");
const OUTPUT_PATH = join(REPORT_DIR, "dashboard.html");

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
const sessionRecord = isRecord(session) ? session : {};
const sessionAccounting = isRecord(sessionRecord.accounting) ? sessionRecord.accounting : {};
const accountingRecord = isRecord(accounting) ? accounting : {};

const budgetUsd =
  numberOrNull(accountingRecord.approvedBudgetUsd) ??
  numberOrNull(sessionAccounting.monthlyCapUsd) ??
  50;
const recordedCostUsd = numberOrNull(accountingRecord.recordedProviderCostUsd);
const unpricedEvents = numberOrNull(accountingRecord.unpricedEvents);
const providerEventCount = numberOrNull(accountingRecord.providerEventCount);
const recordedRemaining = recordedCostUsd === null ? null : Math.max(0, budgetUsd - recordedCostUsd);
const costCoverage = accounting
  ? "PARTIAL — locked-rate ledger valuation, not a provider invoice; unsupported, delayed, missing, or unpriced usage is not free."
  : "NOT REPORTED — accounting artifact is absent; no zero-cost inference is allowed.";
const providerEvents = Array.isArray(accountingRecord.providerEvents)
  ? accountingRecord.providerEvents.filter(isRecord)
  : [];
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
  .filter((name) => name.endsWith(".json"))
  .filter((name) => !["masterinventory.json", "session.json", "accounting.json"].includes(name))
  .sort();
const artifacts = await Promise.all(
  artifactNames.map(async (name) => ({
    name,
    value: sanitizeArtifact(await readJson(join(REPORT_DIR, name))),
  })),
);

const inventoryRows = inventory.map((entry) => `
  <tr>
    <td><strong>${display(entry.feature)}</strong></td>
    <td>${display(entry.ui)}</td>
    <td>${display(entry.api)}</td>
    <td>${display(entry.provider)}</td>
    <td>${display(entry.generation)}</td>
    <td>${display(entry.output)}</td>
    <td>${display(entry.storage)}</td>
    <td>${display(entry.db)}</td>
    <td>${display(entry.export)}</td>
    <td>${display(entry.billing)}</td>
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
    .status { display:inline-block; padding:3px 8px; border-radius:999px; background:#293b55; font-weight:700; white-space:normal; }
    .not_run { color:var(--warn); } .not_testable { color:#ff8e8e; }
    .artifacts { display:grid; gap:12px; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; color:#cfe0f4; }
    code { color:var(--accent); }
  </style>
</head>
<body>
  <header>
    <h1>Live Generation Execution Dashboard</h1>
    <div class="muted">${escapeHtml(fixtureLabel)} · rendered ${escapeHtml(generatedAt)}</div>
    <p>This dashboard reports real-session artifacts without converting static inventory, a reachable port, an empty fixture page, or missing evidence into PASS. Initial unsupported/code-only discoveries remain <strong>NOT_RUN</strong> until proof supports <strong>NOT_TESTABLE</strong>.</p>
  </header>
  <main>
    <section class="cards" aria-label="Budget and accounting">
      <div class="card"><div class="muted">Funded hard budget</div><div class="value">${money(budgetUsd)}</div></div>
      <div class="card"><div class="muted">Recorded provider cost</div><div class="value">${money(recordedCostUsd)}</div></div>
      <div class="card"><div class="muted">Remaining vs recorded only</div><div class="value">${money(recordedRemaining)}</div></div>
      <div class="card"><div class="muted">Recorded provider events</div><div class="value">${providerEventCount ?? "NOT REPORTED"}</div></div>
      <div class="card"><div class="muted">Unpriced events</div><div class="value">${unpricedEvents ?? "NOT REPORTED"}</div></div>
      <div class="card coverage"><div class="muted">Cost coverage</div><div>${escapeHtml(costCoverage)}</div></div>
    </section>

    <h2>Observed provider accounting</h2>
    <p class="muted">Source: <code>accounting.json</code>, observed ${display(accountingRecord.observedAt)}. Request identifiers and sensitive fields are intentionally not rendered.</p>
    <div class="table-wrap">
      <table style="min-width:1100px">
        <thead><tr><th>occurred</th><th>operation</th><th>provider</th><th>model</th><th>unit type</th><th>input</th><th>output</th><th>unit count</th><th>recorded cost</th></tr></thead>
        <tbody>${providerEventRows}</tbody>
      </table>
    </div>

    <h2>Master execution inventory (${inventory.length})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>${REQUIRED_FIELDS.map((field) => `<th>${escapeHtml(field)}</th>`).join("")}</tr></thead>
        <tbody>${inventoryRows}</tbody>
      </table>
    </div>

    <h2>Actual outcome artifacts (${artifacts.length})</h2>
    <p class="muted">Artifacts are escaped before rendering and sensitive-key fields are omitted. Their recorded status is displayed as evidence, not promoted to PASS.</p>
    <div class="artifacts">${artifactCards}</div>
  </main>
</body>
</html>`;

await writeFile(OUTPUT_PATH, html, "utf8");
console.log(`Rendered ${basename(OUTPUT_PATH)} from ${inventory.length} inventory entries and ${artifacts.length} outcome artifacts.`);