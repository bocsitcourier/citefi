/**
 * Scope 0 Content Audit locks. The real audit service and route execute
 * in-process while the database, OpenAI boundary, accounting hooks, and auth
 * boundary are deterministic test doubles. No database mutation or network
 * request is possible.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/scope-0-content-audit.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

const authState = { mode: "allow" as "allow" | "deny", calls: 0 };
const openAiRequests: any[] = [];
const openAiContexts: string[] = [];
const openAiTelemetry: any[] = [];
const openAiResponses: string[] = [];
let selectRows: any[][] = [];
const dbCalls = { select: 0, insert: 0, update: 0, delete: 0 };
const dbPredicates: Array<{ operation: string; sql: string; params: unknown[] }> = [];
const pgDialect = new PgDialect();

function query(rows: any[]) {
  const pending: any = Promise.resolve(rows);
  pending.limit = async () => rows;
  return pending;
}

const fakeDb = {
  select: () => {
    dbCalls.select++;
    return {
      from: () => ({
        where: (predicate: unknown) => {
          const compiled = pgDialect.sqlToQuery(predicate as any);
          dbPredicates.push({
            operation: dbCalls.select === 1 ? "article-read" : "link-target-read",
            sql: compiled.sql,
            params: compiled.params,
          });
          return query(selectRows.shift() ?? []);
        },
      }),
    };
  },
  insert: () => {
    dbCalls.insert++;
    throw new Error("Content audit must not insert");
  },
  update: () => {
    dbCalls.update++;
    throw new Error("Content audit must not update");
  },
  delete: () => {
    dbCalls.delete++;
    throw new Error("Content audit must not delete");
  },
};

const authUrl = new URL("../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    withAuthenticatedTeamContext: async (
      _request: NextRequest,
      callback: (auth: { userId: number; teamId: number; role: string }) => unknown,
    ) => {
      authState.calls++;
      if (authState.mode === "deny") return Response.json({ error: "Access denied" }, { status: 401 });
      return await callback({ userId: 801, teamId: 802, role: "team_member" });
    },
  },
});

const dbUrl = new URL("../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, { namedExports: { db: fakeDb } });

const costTelemetryUrl = new URL("../lib/cost-telemetry.ts", import.meta.url).href;
moduleMock(costTelemetryUrl, {
  namedExports: {
    isProviderAccountingError: () => false,
  },
});

const openAiClientMock = {
  namedExports: {
    openaiClient: {},
    callOpenAI: async (
      operation: unknown,
      context: string,
      _timeoutMs?: number,
      telemetry?: unknown,
    ) => {
      openAiContexts.push(context);
      openAiTelemetry.push(telemetry);
      const content = openAiResponses.shift();
      if (content === undefined) throw new Error("No OpenAI audit fixture configured");
      const fakeClient = {
        chat: {
          completions: {
            create: async (request: unknown) => {
              openAiRequests.push(request);
              return {
                id: "scope0-audit-openai",
                model: "scope0-audit-model",
                choices: [{ message: { content } }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              };
            },
          },
        },
      };
      return await (operation as (client: unknown) => Promise<unknown>)(fakeClient);
    },
  },
};
moduleMock(new URL("../lib/openai-client", import.meta.url).href, openAiClientMock);

// Content-audit tests replace the OpenAI and DB adapters above. Keep the
// receipt core at its exact boundary as well: importing its production
// persistence adapter would require getTxDb and could accidentally open a
// database connection during a read-only route test.
const receiptMock = {
  namedExports: {
    isProviderAttemptTerminalError: () => false,
  },
};
moduleMock(new URL("../lib/provider-attempt-receipts", import.meta.url).href, receiptMock);

function reset() {
  authState.mode = "allow";
  authState.calls = 0;
  openAiRequests.length = 0;
  openAiContexts.length = 0;
  openAiTelemetry.length = 0;
  openAiResponses.length = 0;
  selectRows = [];
  dbCalls.select = 0;
  dbCalls.insert = 0;
  dbCalls.update = 0;
  dbCalls.delete = 0;
  dbPredicates.length = 0;
}

function fixtureArticle(teamId: number) {
  return {
    id: 41,
    teamId,
    chosenTitle: "Fixture home energy audit",
    finalHtmlContent: "<h1>Fixture audit</h1><p>Grounded fixture content.</p>",
  };
}

const auditJson = JSON.stringify({
  overallScore: 4,
  citationPotential: "high",
  criteria: {
    directAnswerCompliance: { score: 4, rationale: "Fixture" },
    entitySalience: { score: 4, rationale: "Fixture" },
    eeeatSignals: { score: 4, rationale: "Fixture" },
    passageQuality: { score: 4, rationale: "Fixture" },
    schemaReadiness: { score: 4, rationale: "Fixture" },
    geoOptimization: { score: 4, rationale: "Fixture" },
  },
  recommendations: ["Fixture recommendation"],
  complianceIssues: [],
});

const linksJson = JSON.stringify({
  opportunities: [{
    anchorText: "fixture energy checklist",
    targetArticleId: 42,
    targetArticleTitle: "Fixture checklist",
    context: "Fixture context.",
    relevanceScore: 0.9,
  }],
});

beforeEach(reset);

test("real auditArticle returns all six criteria and same-team internal links read-only", async () => {
  const { auditArticle } = await import("../lib/content-audit.js");
  selectRows = [
    [fixtureArticle(10)],
    [{ id: 42, title: "Fixture checklist", finalHtml: "<p>Fixture target.</p>" }],
  ];
  openAiResponses.push(auditJson, linksJson);

  const result = await auditArticle(41, 10);

  assert.equal(result.overallScore, 4);
  assert.deepEqual(Object.keys(result.criteria).sort(), [
    "directAnswerCompliance",
    "eeeatSignals",
    "entitySalience",
    "geoOptimization",
    "passageQuality",
    "schemaReadiness",
  ]);
  assert.equal(result.internalLinkOpportunities.length, 1);
  assert.equal(result.internalLinkOpportunities[0]?.targetArticleId, 42);
  assert.deepEqual(openAiContexts, [
    "Content quality audit",
    "Internal link discovery: article 41",
  ]);
  assert.equal(openAiRequests.length, 2);
  assert.equal(openAiRequests[0].model, "gpt-4.1-mini");
  assert.equal(openAiRequests[0].response_format.type, "json_object");
  assert.match(openAiRequests[0].messages[1].content, /Grounded fixture content/);
  assert.equal(openAiTelemetry[0].operationType, "article_review");
  assert.equal(openAiTelemetry[0].teamId, undefined);
  assert.equal(openAiTelemetry[0].articleId, undefined);
  assert.equal(openAiTelemetry[1].operationType, "article_hyperlink");
  assert.equal(openAiTelemetry[1].teamId, 10);
  assert.equal(openAiTelemetry[1].articleId, 41);
  assert.match(dbPredicates[0]!.sql, /"articles"\."id" = \$1/);
  assert.deepEqual(dbPredicates[0]!.params, [41]);
  assert.match(dbPredicates[1]!.sql, /"articles"\."team_id" = \$1/);
  assert.deepEqual(dbPredicates[1]!.params, [10]);
  assert.equal(dbCalls.insert, 0);
  assert.equal(dbCalls.update, 0);
  assert.equal(dbCalls.delete, 0);
});

test("real content-audit route returns exact authenticated serialized audit output", async () => {
  const { POST } = await import("../app/api/seo/content-audit/route.js");
  selectRows = [
    [fixtureArticle(802)],
    [{ id: 42, title: "Fixture checklist", finalHtml: "<p>Fixture target.</p>" }],
  ];
  openAiResponses.push(auditJson, linksJson);
  const response = await POST(new NextRequest("http://localhost/api/seo/content-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articleId: 41 }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    overallScore: 4,
    citationPotential: "high",
    criteria: {
      directAnswerCompliance: { score: 4, rationale: "Fixture" },
      entitySalience: { score: 4, rationale: "Fixture" },
      eeeatSignals: { score: 4, rationale: "Fixture" },
      passageQuality: { score: 4, rationale: "Fixture" },
      schemaReadiness: { score: 4, rationale: "Fixture" },
      geoOptimization: { score: 4, rationale: "Fixture" },
    },
    internalLinkOpportunities: [{
      anchorText: "fixture energy checklist",
      targetArticleId: 42,
      targetArticleTitle: "Fixture checklist",
      context: "Fixture context.",
      relevanceScore: 0.9,
    }],
    recommendations: ["Fixture recommendation"],
    complianceIssues: [],
  });
  assert.equal(authState.calls, 1);
  assert.match(dbPredicates[0]!.sql, /"articles"\."id" = \$1/);
  assert.deepEqual(dbPredicates[0]!.params, [41]);
  assert.match(dbPredicates[1]!.sql, /"articles"\."team_id" = \$1/);
  assert.deepEqual(dbPredicates[1]!.params, [802]);
});

test("real auditArticle rejects wrong-team articles before any provider call", async () => {
  const { auditArticle } = await import("../lib/content-audit.js");
  selectRows = [[fixtureArticle(99)]];

  await assert.rejects(auditArticle(41, 10), /Unauthorized/);
  assert.equal(dbCalls.select, 1);
  assert.equal(openAiRequests.length, 0);
  assert.equal(dbCalls.insert, 0);
  assert.equal(dbCalls.update, 0);
  assert.equal(dbCalls.delete, 0);
});

test("real auditArticle rejects missing articles before any provider call", async () => {
  const { auditArticle } = await import("../lib/content-audit.js");
  selectRows = [[]];

  await assert.rejects(auditArticle(404, 10), /Article 404 not found/);
  assert.equal(dbCalls.select, 1);
  assert.equal(openAiRequests.length, 0);
  assert.equal(dbCalls.insert, 0);
  assert.equal(dbCalls.update, 0);
  assert.equal(dbCalls.delete, 0);
});

test("real content-audit route returns 400 for missing articleId and 401 for denied auth", async () => {
  const { POST } = await import("../app/api/seo/content-audit/route.js");
  const request = (body: unknown) => new NextRequest("http://localhost/api/seo/content-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  authState.mode = "allow";
  let response = await POST(request({}));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Article ID is required/);
  assert.equal(dbCalls.select, 0);
  assert.equal(openAiRequests.length, 0);

  reset();
  authState.mode = "deny";
  response = await POST(request({ articleId: 41 }));
  assert.equal(response.status, 401);
  assert.equal(authState.calls, 1);
  assert.equal(dbCalls.select, 0);
  assert.equal(openAiRequests.length, 0);
});