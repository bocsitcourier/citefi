import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import { seoLogs, articles } from "../../shared/schema";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:55489/fixture";

let authMode: "allow" | "deny" = "allow";
let analysisMode: "success" | "timeout" = "success";
let seoDatabaseMode: "success" | "timeout" = "success";
let analysisCalls = 0;

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown> },
) => void;

const authUrl = new URL("../../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    requireAdmin: async () => {
      if (authMode === "deny") {
        const error: any = new Error("Unauthorized");
        error.statusCode = 401;
        throw error;
      }
      return 71;
    },
  },
});

const incidentUrl = new URL("../../lib/incident-intelligence/service.ts", import.meta.url).href;
moduleMock(incidentUrl, {
  namedExports: {
    getIncidentDetail: async (id: string) => ({
      incident: { id, evidenceVersion: 2 },
      evidence: [{
        id: "event-1",
        occurredAt: "2044-02-03T00:00:00.000Z",
        message: "fixture timeout",
        stack: null,
        metadata: { component: "fixture" },
      }],
    }),
  },
});

const analysisUrl = new URL("../../lib/incident-intelligence/ai-analysis.ts", import.meta.url).href;
moduleMock(analysisUrl, {
  namedExports: {
    getOrCreateIncidentAnalysis: async () => {
      analysisCalls += 1;
      if (analysisMode === "timeout") throw new Error("stub incident model timeout");
      return {
        summary: "The fixture provider timed out.",
        likelyCauses: [{ cause: "Upstream latency", evidenceRefs: ["event-1"] }],
        recommendedChecks: [{ check: "Inspect upstream latency", evidenceRefs: ["event-1"] }],
        confidence: 0.6,
        insufficientEvidence: false,
        missingEvidence: [],
        safetyNotice: "Advisory only; no fixes were executed.",
      };
    },
    refreshIncidentAnalysis: async () => {
      if (analysisMode === "timeout") throw new Error("stub incident model timeout");
      return {
        summary: "Refreshed fixture advisory.",
        likelyCauses: [],
        recommendedChecks: [],
        confidence: 0.2,
        insufficientEvidence: true,
        missingEvidence: ["More evidence"],
        safetyNotice: "Advisory only; no fixes were executed.",
      };
    },
  },
});

function seoQueryChain(table?: unknown) {
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
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      if (seoDatabaseMode === "timeout") {
        return Promise.reject(new Error("stub admin SEO database timeout")).then(onFulfilled, onRejected);
      }
      if (table === seoLogs && !joined) {
        return Promise.resolve([{
          totalTokenCost: 320,
          avgGeoScore: 88,
          totalArticles: 2,
          avgTokensPerArticle: 160,
        }]).then(onFulfilled, onRejected);
      }
      if (table === seoLogs && joined) {
        return Promise.resolve([{
          articleId: 901,
          title: "Fixture SEO article",
          geoScore: 91,
          tokenCost: 140,
          wordCount: 1200,
        }]).then(onFulfilled, onRejected);
      }
      return Promise.resolve([]).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const dbUrl = new URL("../../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, {
  namedExports: {
    systemDb: {
      select: () => seoQueryChain(),
    },
  },
});

function request(method: "GET" | "POST", path: string, body?: unknown) {
  return new NextRequest(`http://fixture.local${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const { POST: analyzeIncident } = await import("../../app/api/admin/incidents/[id]/analysis/route.js");
const { GET: seoReport } = await import("../../app/api/admin/seo-report/route.js");

test("admin incident analysis executes advisory output and duplicate retrieval", async () => {
  authMode = "allow";
  analysisMode = "success";
  analysisCalls = 0;
  const path = "/api/admin/incidents/11111111-1111-4111-8111-111111111111/analysis";
  const first = await analyzeIncident(request("POST", path, {}), {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.advisory, true);
  assert.equal(body.analysis.safetyNotice, "Advisory only; no fixes were executed.");

  const duplicate = await analyzeIncident(request("POST", path, {}), {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), body);
  assert.equal(analysisCalls, 2);
});

test("admin incident analysis maps invalid id, timeout, and non-admin paths", async () => {
  authMode = "allow";
  const invalid = await analyzeIncident(request("POST", "/api/admin/incidents/not-a-uuid/analysis", {}), {
    params: Promise.resolve({ id: "not-a-uuid" }),
  });
  assert.equal(invalid.status, 400);

  analysisMode = "timeout";
  const timeout = await analyzeIncident(request("POST", "/api/admin/incidents/11111111-1111-4111-8111-111111111111/analysis", {}), {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(timeout.status, 500);
  assert.equal((await timeout.json()).error, "Failed to analyze incident");

  authMode = "deny";
  analysisMode = "success";
  const denied = await analyzeIncident(request("POST", "/api/admin/incidents/11111111-1111-4111-8111-111111111111/analysis", {}), {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });
  assert.equal(denied.status, 401);
  authMode = "allow";
});

test("admin SEO report retrieves local fixture aggregates twice without external calls", async () => {
  authMode = "allow";
  seoDatabaseMode = "success";
  const first = await seoReport(request("GET", "/api/admin/seo-report"));
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.costOverview.totalTokenCost, 320);
  assert.equal(body.topPerformingArticles[0].geoScore, 91);
  assert.equal(body.bottomPerformingArticles[0].articleId, 901);

  const duplicate = await seoReport(request("GET", "/api/admin/seo-report"));
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), body);
});

test("admin SEO report maps database timeout and authorization failure", async () => {
  seoDatabaseMode = "timeout";
  const timeout = await seoReport(request("GET", "/api/admin/seo-report"));
  assert.equal(timeout.status, 500);
  assert.match((await timeout.json()).error, /admin SEO database timeout/);

  seoDatabaseMode = "success";
  authMode = "deny";
  const denied = await seoReport(request("GET", "/api/admin/seo-report"));
  assert.equal(denied.status, 401);
  authMode = "allow";
});