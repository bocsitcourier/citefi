import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";
import {
  contentPerformanceMetrics,
  learningPatterns,
  patternDimensionStats,
  variantArms,
} from "../../shared/schema";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:55489/fixture";

let authMode: "allow" | "deny" = "allow";
let corpusMode: "success" | "timeout" = "success";
let databaseMode: "success" | "timeout" = "success";
let corpusCalls = 0;

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown> },
) => void;

const authUrl = new URL("../../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    withAuthenticatedTeamContext: async (
      _request: NextRequest,
      callback: (context: { teamId: number; userId: number; role: string }) => unknown,
    ) => authMode === "allow"
      ? callback({ teamId: 23, userId: 71, role: "admin" })
      : Response.json({ error: "Unauthorized" }, { status: 401 }),
  },
});

const reviewUrl = new URL("../../lib/content-review-service.ts", import.meta.url).href;
moduleMock(reviewUrl, {
  namedExports: {
    contentReviewService: {
      mineCorpus: async () => {
        corpusCalls += 1;
        if (corpusMode === "timeout") throw new Error("stub judge timeout");
        return corpusCalls === 1
          ? { mined: 2, judged: 1, duplicates: 0 }
          : { mined: 0, judged: 0, duplicates: 2 };
      },
    },
  },
});

const learningUrl = new URL("../../lib/learning-service.ts", import.meta.url).href;
moduleMock(learningUrl, {
  namedExports: {
    learningService: {
      teamDataMaturity: async () => {
        if (databaseMode === "timeout") throw new Error("stub learning database timeout");
        return "learning";
      },
    },
    thompsonSample: () => 0.75,
    METRIC_WEIGHTS: { article: { quality: 0.4, engagement: 0.35, conversion: 0.25 } },
  },
});

const fixtureRows: Record<string, unknown[]> = {
  patterns: [{
    id: 1,
    patternName: "Direct Answer",
    patternType: "opening_style",
    isArchived: false,
    weakWeekCount: 0,
    successRate: 82,
    timesUsed: 12,
  }],
  arms: [{
    id: 10,
    teamId: 23,
    contentType: "article",
    armName: "treatment",
    allocationPct: 90,
    isActive: true,
  }, {
    id: 11,
    teamId: 23,
    contentType: "article",
    armName: "holdout",
    allocationPct: 10,
    isActive: true,
  }],
  dimensions: [{ patternId: 1, dimension: "engagement", successes: 8, trials: 10, wilsonScore: 64 }],
  metrics: [{ successes: 8, total: 10 }],
};

function queryChain(selection?: unknown) {
  let table: unknown;
  const chain: any = {
    from(input: unknown) {
      table = input;
      return chain;
    },
    where() { return chain; },
    innerJoin() { return chain; },
    leftJoin() { return chain; },
    groupBy() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      if (databaseMode === "timeout") {
        return Promise.reject(new Error("stub decisioning database timeout")).then(onFulfilled, onRejected);
      }
      const rows = table === learningPatterns
        ? fixtureRows.patterns
        : table === variantArms
          ? fixtureRows.arms
          : table === patternDimensionStats
            ? fixtureRows.dimensions
            : table === contentPerformanceMetrics
              ? fixtureRows.metrics
              : [];
      // The decisioning route requests count/aggregate projections for metrics.
      // The fixture values intentionally remain deterministic for repeat reads.
      if (selection && typeof selection === "object" && ("count" in selection || "successes" in selection)) {
        return Promise.resolve(fixtureRows.metrics).then(onFulfilled, onRejected);
      }
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return chain;
}

const dbUrl = new URL("../../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, {
  namedExports: {
    db: { select: (selection?: unknown) => queryChain(selection) },
  },
});

function request(method: "GET" | "POST", path: string, body?: unknown) {
  return new NextRequest(`http://fixture.local${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const { POST: mineCorpus } = await import("../../app/api/learning/mine-corpus/route.js");
const { GET: decisionSummary } = await import("../../app/api/decisioning/summary/route.js");

test("learning corpus route executes a stub-judged positive run and duplicate run", async () => {
  authMode = "allow";
  corpusMode = "success";
  corpusCalls = 0;
  const first = await mineCorpus(request("POST", "/api/learning/mine-corpus", {
    contentType: "article",
    limit: 5,
    judgeSampleRate: 1,
  }));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { success: true, mined: 2, judged: 1, duplicates: 0 });

  const duplicate = await mineCorpus(request("POST", "/api/learning/mine-corpus", { contentType: "article" }));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicates, 2);
  assert.equal(corpusCalls, 2);
});

test("learning corpus route maps invalid, timeout, and authorization paths", async () => {
  authMode = "allow";
  corpusMode = "success";
  const invalid = await mineCorpus(request("POST", "/api/learning/mine-corpus", {}));
  assert.equal(invalid.status, 400);

  corpusMode = "timeout";
  const timeout = await mineCorpus(request("POST", "/api/learning/mine-corpus", { contentType: "article" }));
  assert.equal(timeout.status, 500);
  assert.equal((await timeout.json()).error, "Failed to mine corpus");

  authMode = "deny";
  const denied = await mineCorpus(request("POST", "/api/learning/mine-corpus", { contentType: "article" }));
  assert.equal(denied.status, 401);
  authMode = "allow";
});

test("decisioning summary returns readiness layers and is stable on duplicate retrieval", async () => {
  databaseMode = "success";
  authMode = "allow";
  const first = await decisionSummary(request("GET", "/api/decisioning/summary?contentType=article"));
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.contentType, "article");
  assert.equal(body.maturity, "learning");
  assert.equal(body.patterns[0].thompsonScore, 75);
  assert.ok(body.readinessGates);
  assert.equal(body.arms.length, 2);

  const duplicate = await decisionSummary(request("GET", "/api/decisioning/summary?contentType=article"));
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), body);
});

test("decisioning summary exposes auth and database timeout failures", async () => {
  authMode = "deny";
  const denied = await decisionSummary(request("GET", "/api/decisioning/summary"));
  assert.equal(denied.status, 401);

  authMode = "allow";
  databaseMode = "timeout";
  const timeout = await decisionSummary(request("GET", "/api/decisioning/summary"));
  assert.equal(timeout.status, 500);
  assert.equal((await timeout.json()).error, "Failed to fetch decisioning summary");
  databaseMode = "success";
});