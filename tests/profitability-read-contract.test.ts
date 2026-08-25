import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// DB-free contract checks: these read routes must remain ledger-based and the
// agency surface must remain rooted at the authenticated direct-parent scope.
test("platform profitability read uses immutable ledger and reconciliation records", () => {
  const route = readFileSync("app/api/admin/cost-telemetry/route.ts", "utf8");
  assert.match(route, /providerUsageLedger/);
  assert.match(route, /providerInvoiceReconciliations/);
  assert.match(route, /creditProviderReconciliation/);
  assert.match(route, /ledgerRunsWithoutCreditDebit/);
  assert.match(route, /creditLedger/);
  assert.match(route, /requireAdmin\(req\)/);
  assert.doesNotMatch(route, /\.from\(costTelemetry\)/);
});

test("agency profitability read is team-admin guarded and excludes unconfigured margin", () => {
  const route = readFileSync("app/api/agency/profitability/route.ts", "utf8");
  assert.match(route, /requireTeamAdmin\(req\)/);
  assert.match(route, /eq\(teams\.parentTeamId, teamId\)/);
  assert.match(route, /revenueConfigured: false/);
  assert.match(route, /margin: null/);
  assert.doesNotMatch(route, /new URL\(req\.url\).*teamId/);
});