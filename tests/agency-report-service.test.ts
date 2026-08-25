import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
const reports = await import("../lib/agency-report-service");
const migration = readFileSync("migrations/0019_agency_client_reports.sql", "utf8");
const serviceSource = readFileSync("lib/agency-report-service.ts", "utf8");

test("client snapshot sanitizer recursively excludes private accounting and generation data", () => {
  const safe = reports.sanitizeClientSnapshot({
    title: "Summary",
    prompt: "secret",
    nested: { views: 12, provider: "openai", modelName: "private", internalError: "stack" },
    rows: [{ clicks: 2, cogsMicrousd: 50, margin: 10 }],
  });
  assert.deepEqual(safe, { title: "Summary", nested: { views: 12 }, rows: [{ clicks: 2 }] });
  assert.doesNotMatch(JSON.stringify(safe), /secret|openai|cogs|margin|internalError/);
});

test("report hashes are deterministic across object insertion order", () => {
  const first = reports.deterministicReportSha256({ b: 2, a: { y: 2, x: 1 } }, { cost: 10 });
  const second = reports.deterministicReportSha256({ a: { x: 1, y: 2 }, b: 2 }, { cost: 10 });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("approved markup reconciliation uses integer microUSD and draft revenue is unavailable", () => {
  assert.deepEqual(reports.reconcileAgencyRebilling(1_000_000, 42, {
    approvalStatus: "approved", markupBasisPoints: 2_500,
  }), {
    providerCostMicrousd: 1_000_000, creditDebits: 42,
    approvedMarkupBasisPoints: 2_500, revenueMicrousd: 1_250_000,
    marginMicrousd: 250_000, revenueAvailable: true,
  });
  const draft = reports.reconcileAgencyRebilling(1_000_000, 42, {
    approvalStatus: "draft", markupBasisPoints: 2_500,
  });
  assert.equal(draft.revenueMicrousd, null);
  assert.equal(draft.marginMicrousd, null);
  assert.equal(draft.approvedMarkupBasisPoints, null);
});

test("direct-child isolation and client approved-only boundary are database enforced", () => {
  assert.match(migration, /c\.parent_team_id=a\.id/);
  assert.match(migration, /c\.client_status='active'/);
  assert.match(migration, /a\.billing_plan='agency'/);
  assert.match(migration, /status IN \('approved','sent'\)/);
  assert.match(migration, /client_team_id=citefi_rls\.current_team_id\(\)/);
  assert.match(migration, /agency report deliveries are append-only/);
  assert.match(migration, /agency report financial snapshots are immutable/);
  assert.match(migration, /CREATE POLICY agency_report_financial_snapshots_admin/);
  assert.doesNotMatch(migration, /agency_report_financial_snapshots_client/);
  assert.match(migration, /agency_report_period_evidence/);
  assert.match(migration, /SECURITY DEFINER SET row_security=off/);
  assert.match(migration, /DROP POLICY IF EXISTS agency_report_credit_ledger_select/);
  assert.doesNotMatch(migration, /CREATE POLICY agency_report_credit_ledger_select/);
  assert.match(migration, /agency_client_reports_id_agency_client_unique/);
  assert.match(migration, /agency_report_deliveries_report_pair_fk/);
  assert.match(migration, /ALTER TABLE agency_client_reports DROP COLUMN agency_rebilling_snapshot/);
  assert.doesNotMatch(migration, /client_safe_snapshot jsonb NOT NULL,\s*agency_rebilling_snapshot/);
});

test("client-facing service selects only safe report columns and missing metrics remain explicit", () => {
  const clientRead = serviceSource.slice(serviceSource.indexOf("export async function getApprovedClientSafeReports"));
  assert.doesNotMatch(clientRead, /agencyRebillingSnapshot|agencyReportFinancialSnapshots|rebillingSnapshot|agencyReportConfigs|markupBasisPoints/);
  assert.match(migration, /No content performance metrics recorded for this period/);
  assert.match(serviceSource, /citefi_rls\.agency_report_period_evidence/);
  assert.match(serviceSource, /onConflictDoNothing\(\)/);
});