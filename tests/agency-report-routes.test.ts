import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
const service = await import("../lib/agency-report-service");

const read = (path: string) => readFileSync(path, "utf8");
const agencyRoutes = [
  "app/api/agency/reports/route.ts",
  "app/api/agency/reports/config/route.ts",
  "app/api/agency/reports/config/approve/route.ts",
  "app/api/agency/reports/generate/route.ts",
  "app/api/agency/reports/[id]/route.ts",
  "app/api/agency/reports/[id]/approve/route.ts",
  "app/api/agency/reports/[id]/download/route.ts",
  "app/api/agency/reports/[id]/send/route.ts",
];

test("all agency report routes require agency admin authentication", () => {
  for (const route of agencyRoutes) assert.match(read(route), /requireTeamAdmin\(request\)/, route);
});

test("client routes require reviewer auth and never reference agency-only projections", () => {
  for (const route of [
    "app/api/client/reports/route.ts",
    "app/api/client/reports/[id]/download/route.ts",
  ]) {
    const source = read(route);
    assert.match(source, /requireClientReviewer\(request\)/);
    assert.doesNotMatch(source, /agencyRebilling|markup|prompt|provider|model|cost|internalError/i);
  }
});

test("client HTML renderer escapes content and strips private snapshot keys", () => {
  const html = service.renderClientSafeReportHtml({
    branding: { displayName: "<Client>", accentColor: "#123abc" },
    summary: "<script>alert(1)</script>",
    provider: "secret",
    nested: { internalError: "stack", views: 7 },
  });
  assert.match(html, /&lt;Client&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /secret|stack/);
  assert.doesNotMatch(html, /<script/i);
});

test("rebilling CSV is deterministic and unavailable for draft configuration snapshots", () => {
  const snapshot = {
    providerCostMicrousd: 100, creditDebits: 2, approvedMarkupBasisPoints: 2500,
    revenueMicrousd: 125, marginMicrousd: 25, revenueAvailable: true,
  };
  assert.equal(service.renderAgencyRebillingCsv(snapshot), service.renderAgencyRebillingCsv({ ...snapshot }));
  assert.throws(() => service.renderAgencyRebillingCsv({
    ...snapshot, revenueAvailable: false, revenueMicrousd: null,
  }), /not available/);
});

test("download contracts set safe attachment headers and client reads are approved-only", () => {
  const agencyDownload = read("app/api/agency/reports/[id]/download/route.ts");
  const clientDownload = read("app/api/client/reports/[id]/download/route.ts");
  assert.match(agencyDownload, /Content-Disposition/);
  assert.match(agencyDownload, /recordAgencyReportDelivery/);
  assert.match(agencyDownload, /Report must be approved before rebilling export/);
  assert.match(clientDownload, /Content-Disposition/);
  const source = read("lib/agency-report-service.ts");
  assert.match(source, /status\} IN \('approved','sent'\)/);
});

test("send contract serializes recipient sends and records redacted success or failure history", () => {
  const source = read("lib/agency-report-service.ts");
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /Email delivery failed/);
  assert.match(source, /recipientHash = createHash\("sha256"\)/);
  assert.match(source, /:attempt:\$\{pending\.length \+ 1\}:pending/);
  assert.match(source, /skip-uncertain/);
  assert.match(source, /prior\.some\(\(delivery\) => delivery\.status === "sent"/);
  assert.doesNotMatch(read("app/api/agency/reports/[id]/send/route.ts"), /error\.stack|error\.cause/);
});