import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const ledger = await import("../lib/provider-usage-ledger");
const { articles, teamMembers } = await import("../shared/schema");

function fakeTx(rows: Map<unknown, unknown[]> = new Map()): any {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => rows.get(table) ?? [],
        }),
      }),
    }),
  };
}

test("the receipt resource allow-list includes every current telemetry resource family", () => {
  for (const resourceType of [
    "article",
    "article_hero",
    "article_title_pool",
    "batch",
    "brand_profile",
    "canary",
    "campaign",
    "daily_brief",
    "fact_validation",
    "incident",
    "media_asset",
    "podcast",
    "reddit_intent",
    "seo_analysis",
    "social_post",
    "topic_research",
    "video",
    "video_idea",
    "video_scene",
  ]) {
    assert.ok(ledger.PROVIDER_USAGE_RESOURCE_TYPES.includes(resourceType as never), resourceType);
  }
});

test("unknown resource types and untyped resource IDs fail closed before a query", async () => {
  const queryBomb = {
    select: () => {
      throw new Error("ownership query should not run");
    },
  };
  await assert.rejects(
    ledger.validateProviderUsageAttribution(queryBomb, 7, null, null, "future_resource", "1"),
    /resourceType future_resource is not recognized/,
  );
  await assert.rejects(
    ledger.validateProviderUsageAttribution(queryBomb, 7, null, null, null, "1"),
    /resourceId requires an explicit resourceType/,
  );
});

test("provided user IDs must be members of the accounting team", async () => {
  await assert.rejects(
    ledger.validateProviderUsageAttribution(fakeTx(), 7, null, null, null, null, 11),
    /user 11 is not a member of team 7/,
  );

  const tx = fakeTx(new Map<unknown, unknown[]>([
    [teamMembers, [{ id: 1 }]],
    [articles, [{ id: 41 }]],
  ]));
  await ledger.validateProviderUsageAttribution(tx, 7, null, 41, "article", 41, 11);
});

test("article resource IDs are checked against the resolved team", async () => {
  await assert.rejects(
    ledger.validateProviderUsageAttribution(fakeTx(), 7, null, null, "article", 41),
    /article 41 does not belong to team 7/,
  );
});

test("idempotent usage matches units and attribution but preserves the first occurredAt", () => {
  const input = {
    sourceEventId: "provider-usage:test",
    teamId: 7,
    campaignId: 3,
    runId: "run-1",
    jobId: "job-1",
    contentId: 41,
    resourceType: "article",
    resourceId: 41,
    operationType: "article_generation",
    provider: "gemini",
    model: "gemini-2.5-flash",
    unitType: "tokens",
    inputUnits: 12,
    outputUnits: 8,
    unitCount: 20,
    costMicrousd: 999999,
    providerRequestId: "response-1",
  };
  const existing = {
    ...input,
    resourceId: "41",
    eventType: "usage",
    occurredAt: new Date("2025-01-01T00:00:00.000Z"),
  };

  assert.doesNotThrow(() => ledger.assertIdempotentUsageMatch(existing, input, 7));
  assert.throws(
    () => ledger.assertIdempotentUsageMatch(existing, { ...input, outputUnits: 9 }, 7),
    /different accounting event/,
  );
  assert.throws(
    () => ledger.assertIdempotentUsageMatch(existing, { ...input, resourceId: 42 }, 7),
    /different accounting event/,
  );
  assert.throws(
    () => ledger.assertIdempotentUsageMatch(existing, { ...input, providerRequestId: "response-2" }, 7),
    /different accounting event/,
  );
});