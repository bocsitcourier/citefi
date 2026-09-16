import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL = "postgres://fixture:fixture@127.0.0.1:55489/fixture";
process.env.DATABASE_POOLED_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = "business-acceptance-stub";
process.env.WORKER_PROCESS = "true";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("business acceptance guard: external provider access is forbidden");
}) as typeof fetch;

const { generateDailyBrief } = await import("../../lib/brief/generate-daily-brief");

const VALID_BRIEF = {
  todayFocus: {
    type: "content",
    action: "Publish one useful local guide",
    why: "Publishing cadence is below target.",
    ctaPath: "/dashboard",
    urgencySignal: "Cadence is below target",
  },
  overnightMovement: {
    headline: "No significant overnight movement",
    items: [],
    quietDay: true,
  },
  competitorWatch: {
    headline: "A local content opening is available",
    insights: ["Answer the common patient question competitors leave unexplained."],
  },
  teachingMoment: {
    lesson: "Consistent publishing creates more opportunities for search discovery.",
    groundedIn: "One article has been published this month.",
  },
  voicePrompt: {
    nudge: "Turn one patient question into a clear local answer.",
  },
  motivation: {
    headline: "Your next article has a measurable starting point",
    evidence: ["One article has been published this month."],
  },
};

type BriefRow = {
  status: "generating" | "generated" | "failed";
  sectionsJson?: unknown;
};

function fixture(options: {
  provider: () => Promise<any>;
  failPersist?: () => boolean;
}) {
  const rows = new Map<string, BriefRow>();
  let providerCalls = 0;
  let failedProviderAttempts = 0;
  let persistFailures = 0;
  const date = "2044-02-03";
  const dependencies: Parameters<typeof generateDailyBrief>[4] = {
    findExistingBrief: async (_userId, requestedDate) => rows.get(requestedDate)
      ? {
          status: rows.get(requestedDate)!.status,
          sectionsJson: rows.get(requestedDate)!.sectionsJson,
          todayFocusType: "content",
        }
      : null,
    markGenerating: async (_userId, _teamId, requestedDate) => {
      rows.set(requestedDate, { status: "generating" });
    },
    persistGenerated: async (_userId, requestedDate, input) => {
      if (options.failPersist?.()) {
        persistFailures += 1;
        throw new Error("local fixture storage timeout");
      }
      rows.set(requestedDate, { status: "generated", sectionsJson: input.briefData });
    },
    markFailed: async (_userId, requestedDate) => {
      const row = rows.get(requestedDate);
      if (row) row.status = "failed";
    },
    assembleContext: async () => ({
      userId: 71,
      teamId: 23,
      localDate: date,
      brandProfile: {
        companyName: "Northwind Dental",
        brandVoice: "clear and reassuring",
        targetLocation: "Austin, Texas",
      },
      recentArticles: [],
      topPerformers: [],
      learningPatterns: [],
      competitorInsights: null,
      persona: { name: "local patient", description: "people choosing a nearby dentist" },
      articlesPublishedThisMonth: 1,
      articlesOnPage1: 0,
      daysSinceLastArticle: 8,
      decayingContent: [],
      momentumContent: [],
      contentVelocityLow: true,
    }),
    provider: async () => {
      providerCalls += 1;
      try {
        return await options.provider();
      } catch (error) {
        failedProviderAttempts += 1;
        throw error;
      }
    },
    logCostTelemetry: async () => undefined,
    logFailedProviderAttempt: async () => undefined,
  };
  return {
    date,
    rows,
    dependencies,
    get providerCalls() { return providerCalls; },
    get failedProviderAttempts() { return failedProviderAttempts; },
    get persistFailures() { return persistFailures; },
  };
}

test("daily brief provider timeout is surfaced and marks the local output failed", async () => {
  const flow = fixture({
    provider: async () => {
      throw new Error("stub provider timeout");
    },
  });

  await assert.rejects(
    generateDailyBrief(71, 23, flow.date, false, flow.dependencies),
    /stub provider timeout/,
  );
  assert.equal(flow.providerCalls, 1);
  assert.equal(flow.failedProviderAttempts, 1);
  assert.equal(flow.rows.get(flow.date)?.status, "failed");
  assert.equal(flow.rows.get(flow.date)?.sectionsJson, undefined);
});

test("daily brief recovers from a post-provider local storage failure without losing the chain", async () => {
  let failPersist = true;
  const flow = fixture({
    provider: async () => ({
      text: JSON.stringify(VALID_BRIEF),
      responseId: "business-acceptance-brief",
      modelVersion: "stub-gemini",
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 7, totalTokenCount: 16 },
    }),
    failPersist: () => failPersist,
  });

  await assert.rejects(
    generateDailyBrief(71, 23, flow.date, false, flow.dependencies),
    /local fixture storage timeout/,
  );
  assert.equal(flow.rows.get(flow.date)?.status, "failed");
  assert.equal(flow.persistFailures, 1);

  failPersist = false;
  const recovered = await generateDailyBrief(71, 23, flow.date, true, flow.dependencies);
  assert.equal(recovered?.todayFocus.type, "content");
  assert.equal(flow.rows.get(flow.date)?.status, "generated");
  assert.equal(flow.providerCalls, 2);

  // The generated row is now the retrieval source. A duplicate delivery does not
  // dispatch another provider call or replace the stored output.
  const retrieved = await generateDailyBrief(71, 23, flow.date, false, flow.dependencies);
  assert.deepEqual(retrieved, recovered);
  assert.equal(flow.providerCalls, 2);
});

test("daily brief rejects a partial provider payload and leaves no retrievable output", async () => {
  const flow = fixture({
    provider: async () => ({
      text: JSON.stringify({ ...VALID_BRIEF, teachingMoment: { lesson: "incomplete" } }),
      responseId: "business-acceptance-partial",
      modelVersion: "stub-gemini",
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2, totalTokenCount: 6 },
    }),
  });

  await assert.rejects(
    generateDailyBrief(71, 23, flow.date, false, flow.dependencies),
    /Gemini returned invalid brief shape/,
  );
  assert.equal(flow.providerCalls, 1);
  assert.equal(flow.rows.get(flow.date)?.status, "failed");
  assert.equal(flow.rows.get(flow.date)?.sectionsJson, undefined);
});

process.on("exit", () => {
  globalThis.fetch = originalFetch;
});