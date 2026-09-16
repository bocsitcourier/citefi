import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mock, test } from "node:test";
import { join } from "node:path";
import {
  agencyClientReports,
  agencyReportConfigs,
  agencyReportDeliveries,
} from "../../shared/schema";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:55489/fixture";
process.env.NEXTAUTH_URL = "https://fixture.local";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown> },
) => void;

const state = {
  report: {
    id: 77,
    clientTeamId: 23,
    status: "approved",
    clientSafeSnapshot: {
      branding: { displayName: "Fixture Client", accentColor: "#123abc" },
      summary: "A local report",
      provider: "must-not-leak",
    },
    agencyRebillingSnapshot: {
      providerCostMicrousd: 100,
      creditDebits: 2,
      approvedMarkupBasisPoints: 2500,
      revenueMicrousd: 125,
      marginMicrousd: 25,
      revenueAvailable: true,
    },
  },
  config: {
    recipients: ["reports@fixture.local"],
    displayName: "Fixture Client",
    approvalStatus: "approved",
  },
  deliveries: [] as Array<Record<string, unknown>>,
};

function queryChain(selection?: unknown) {
  let table: unknown;
  let joined = false;
  const chain: any = {
    from(input: unknown) {
      table = input;
      return chain;
    },
    innerJoin() {
      joined = true;
      return chain;
    },
    where() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    for() { return chain; },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      if (table === agencyClientReports && joined) {
        return Promise.resolve([{ ...state.report }]).then(onFulfilled, onRejected);
      }
      if (table === agencyReportConfigs) {
        return Promise.resolve([state.config]).then(onFulfilled, onRejected);
      }
      if (table === agencyReportDeliveries) {
        return Promise.resolve(state.deliveries.slice()).then(onFulfilled, onRejected);
      }
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function insertChain(table: unknown) {
  let values: Record<string, unknown> | undefined;
  const chain: any = {
    values(input: Record<string, unknown>) {
      values = input;
      return chain;
    },
    onConflictDoNothing() { return chain; },
    returning() {
      if (table === agencyReportDeliveries && values) state.deliveries.push({ ...values });
      return Promise.resolve(values ? [values] : []);
    },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      if (table === agencyReportDeliveries && values) state.deliveries.push({ ...values });
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const fixtureDb: any = {
  select: (selection?: unknown) => queryChain(selection),
  insert: (table: unknown) => insertChain(table),
  update: (table: unknown) => {
    const chain: any = {
      set(values: Record<string, unknown>) {
        if (table === agencyClientReports) Object.assign(state.report, values);
        return chain;
      },
      where() { return chain; },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve([]).then(onFulfilled, onRejected);
      },
    };
    return chain;
  },
  execute: async () => ({ rows: [] }),
};

const dbUrl = new URL("../../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, {
  namedExports: {
    db: fixtureDb,
    getTxDb: () => fixtureDb,
    withTenantTransaction: async (callback: (db: unknown) => unknown) => callback(fixtureDb),
  },
});

const tenantUrl = new URL("../../lib/tenant-context.ts", import.meta.url).href;
moduleMock(tenantUrl, {
  namedExports: {
    getDatabaseExecutionContext: () => ({
      scope: "tenant",
      actorType: "web",
      userId: 71,
      teamId: 10,
      role: "admin",
    }),
    runWithSystemContext: async (callback: () => unknown) => callback(),
    runWithTenantContext: async (_teamId: number, callback: () => unknown) => callback(),
  },
});

const reports = await import("../../lib/agency-report-service");
const { websiteAdapter } = await import("../../lib/publishing/channels/website/adapter");
const { getAdapter } = await import("../../lib/publishing/index");

const article = {
  id: 601,
  publicId: "fixture-publication",
  teamId: 23,
  articleStatus: "COMPLETE",
  chosenTitle: "Fixture article | 2044",
  seoTitle: "Fixture article",
  metaDescription: "Fixture description",
  slug: "fixture-article",
  keywordsJson: ["fixture", "local"],
  hashtagsJson: ["#fixture", "#2024"],
  finalHtmlContent: '<h2>Fixture</h2><p onclick="alert(1)">Local guide.</p>',
  heroImageUrl: "/api/public-objects/hero.png",
  metaEnrichment: { jsonLd: { "@type": "Article" } },
} as any;

function connection() {
  return {
    id: 1,
    teamId: 23,
    name: "Fixture website",
    channel: "website",
    baseUrl: "https://receiver.fixture.local/blog",
    apiKeyHash: "fixture-hash",
    status: "active",
  } as any;
}

test("agency report sends through a stub email transport with retry, retrieval, and idempotency", async () => {
  state.deliveries.length = 0;
  state.report.status = "approved";
  let sendCalls = 0;
  const send = async (payload: { to: string; html?: string }) => {
    sendCalls += 1;
    assert.equal(payload.to, "reports@fixture.local");
    assert.doesNotMatch(payload.html ?? "", /must-not-leak/);
    if (sendCalls === 1) throw new Error("stub email timeout");
  };
  const terminal = async (input: Record<string, unknown>) => {
    state.deliveries.push({ ...input });
  };

  const first = await reports.sendApprovedAgencyReport(77, send, terminal as never);
  assert.deepEqual(first.outcomes, [{ recipient: "reports@fixture.local", status: "failed" }]);
  assert.equal(sendCalls, 1);
  assert.equal(state.deliveries.filter((row) => row.status === "failed").length, 1);

  const recovered = await reports.sendApprovedAgencyReport(77, send, terminal as never);
  assert.deepEqual(recovered.outcomes, [{ recipient: "reports@fixture.local", status: "sent" }]);
  assert.equal(sendCalls, 2);
  assert.equal(state.report.status, "sent");

  const duplicate = await reports.sendApprovedAgencyReport(77, send, terminal as never);
  assert.deepEqual(duplicate.outcomes, [{ recipient: "reports@fixture.local", status: "skipped" }]);
  assert.equal(sendCalls, 2);
});

test("agency report exports client-safe HTML and approved rebilling CSV locally", async () => {
  const html = reports.renderClientSafeReportHtml(state.report.clientSafeSnapshot);
  const csv = reports.renderAgencyRebillingCsv(state.report.agencyRebillingSnapshot);
  assert.match(html, /Fixture Client/);
  assert.doesNotMatch(html, /must-not-leak|<script/i);
  assert.match(csv, /providerCostMicrousd/);

  const evidenceDir = join(process.cwd(), "QA", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "business-acceptance-agency-report.html"), html, "utf8");
  await writeFile(join(evidenceDir, "business-acceptance-agency-rebilling.csv"), csv, "utf8");
});

test("website publication adapter dispatches supported content and maps invalid, partial, timeout, and duplicate transport results", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "success" | "partial" | "timeout" | "duplicate" = "success";
  globalThis.fetch = (async () => {
    if (mode === "timeout") throw new Error("stub publisher timeout");
    if (mode === "duplicate") {
      return new Response(JSON.stringify({ details: "duplicate key value violates unique constraint" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    if (mode === "partial") {
      return new Response(JSON.stringify({ success: false, error: "receiver still processing" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      success: true,
      article: { slug: "fixture-article", url: "/articles/fixture-article" },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    assert.equal(websiteAdapter.channel, "website");
    assert.equal(getAdapter("website"), websiteAdapter);
    // Facebook, LinkedIn, and TikTok are not registered production adapters.
    assert.equal(getAdapter("facebook"), undefined);
    assert.equal(getAdapter("linkedin"), undefined);
    assert.equal(getAdapter("tiktok"), undefined);
    const valid = await websiteAdapter.validate({ type: "article", article }, connection());
    assert.equal(valid.valid, true);
    const formatted = await websiteAdapter.format({ type: "article", article }, connection());
    assert.equal((formatted.payload as any).title, "Fixture article - 2044");
    assert.equal((formatted.payload as any).hashtags.length, 1);
    assert.equal((formatted.payload as any).bodyHtml.includes("onclick"), false);

    const delivered = await websiteAdapter.publish(formatted, connection(), "fixture-api-key", "job-1");
    assert.equal(delivered.success, true);
    assert.equal(delivered.publishedUrl, "https://receiver.fixture.local/articles/fixture-article");

    mode = "partial";
    const partial = await websiteAdapter.publish(formatted, connection(), "fixture-api-key", "job-1");
    assert.equal(partial.success, false);
    assert.equal(partial.errorCode, "PUBLISH_FAILED");

    mode = "timeout";
    const timeout = await websiteAdapter.publish(formatted, connection(), "fixture-api-key", "job-1");
    assert.equal(timeout.success, false);
    assert.equal(timeout.errorCode, "NETWORK_ERROR");

    mode = "duplicate";
    const duplicate = await websiteAdapter.publish(formatted, connection(), "fixture-api-key", "job-1");
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.errorCode, "RECEIVER_REJECTED");

    const invalid = await websiteAdapter.validate({
      type: "article",
      article: { ...article, articleStatus: "DRAFT" },
    }, connection());
    assert.equal(invalid.valid, false);
    assert.match(invalid.errors?.join(" ") ?? "", /COMPLETE/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});