import assert from "node:assert/strict";
import test, { after } from "node:test";

// This file is deliberately offline: the production service and Gemini receipt
// adapter are exercised with injected persistence/provider seams. The database
// URL is only needed so importing the production module can construct its
// clients; no database method is called.
process.env.DATABASE_URL = "postgres://offline:offline@127.0.0.1:1/offline";
process.env.DATABASE_POOLED_URL = process.env.DATABASE_URL;
process.env.GEMINI_API_KEY = "offline-test-key";
process.env.WORKER_PROCESS = "true";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("offline guard: provider/network access is forbidden in QA flow");
}) as typeof fetch;

const [{ generateDailyBrief }, gemini, receipts] = await Promise.all([
  import("../../lib/brief/generate-daily-brief"),
  import("../../lib/gemini"),
  import("../../lib/provider-attempt-receipts"),
]);

after(() => {
  globalThis.fetch = originalFetch;
});

const VALID_BRIEF = JSON.stringify({
  todayFocus: {
    type: "content",
    action: "Publish a new article for Northwind Dental",
    why: "One article has been published this month, so a focused local guide is the highest-scored action.",
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
    nudge: "Turn one patient question into a clear, reassuring local answer.",
  },
  motivation: {
    headline: "Your next article has a measurable starting point",
    evidence: ["Northwind has one article published this month."],
  },
});

type FlowFixture = {
  date: string;
  rows: Map<string, {
    status: "generating" | "generated" | "failed";
    sectionsJson?: unknown;
    todayFocusType: string | null;
  }>;
  store: InstanceType<typeof receipts.MemoryProviderAttemptReceiptStore>;
  spool: InstanceType<typeof receipts.MemoryProviderAttemptReceiptSpool>;
  ledger: Array<Record<string, unknown>>;
  physicalProviderCalls: number;
  usageAttempts: number;
  dependencies: Parameters<typeof generateDailyBrief>[4];
};

function fixtureContext(userId: number, teamId: number, localDate: string) {
  return {
    userId,
    teamId,
    localDate,
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
  };
}

function createFixture(options: {
  responseText?: string;
  stableInvocationKey?: string;
  validateOwnership?: (context: unknown) => Promise<unknown>;
  failFirstLedgerWrite?: boolean;
} = {}): FlowFixture {
  const userId = 71;
  const teamId = 23;
  const date = "2026-08-23";
  const rows = new Map<FlowFixture["date"], {
    status: "generating" | "generated" | "failed";
    sectionsJson?: unknown;
    todayFocusType: string | null;
  }>();
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  const ledger: Array<Record<string, unknown>> = [];
  let physicalProviderCalls = 0;
  let usageAttempts = 0;
  const responseText = options.responseText ?? VALID_BRIEF;
  const stableInvocationKey = options.stableInvocationKey ?? "qa:daily-brief:stable";

  const dependencies: Parameters<typeof generateDailyBrief>[4] = {
    findExistingBrief: async (_requestedUserId, requestedDate) => {
      const row = rows.get(requestedDate);
      return row
        ? {
            status: row.status,
            sectionsJson: row.sectionsJson,
            todayFocusType: row.todayFocusType,
          }
        : null;
    },
    markGenerating: async (_requestedUserId, _requestedTeamId, requestedDate) => {
      const row = rows.get(requestedDate);
      if (row) {
        row.status = "generating";
      } else {
        rows.set(requestedDate, {
          status: "generating",
          todayFocusType: null,
        });
      }
    },
    persistGenerated: async (_requestedUserId, requestedDate, input) => {
      rows.set(requestedDate, {
        status: "generated",
        sectionsJson: input.briefData,
        todayFocusType: input.todayFocusType,
      });
    },
    markFailed: async (_requestedUserId, requestedDate) => {
      const row = rows.get(requestedDate);
      if (row) row.status = "failed";
    },
    assembleContext: async (requestedUserId, requestedTeamId, requestedDate) =>
      fixtureContext(requestedUserId, requestedTeamId, requestedDate),
    provider: async (request, context) =>
      gemini.submitGeminiRequest(
        request,
        {
          ...context,
          // Direct test calls are outside a worker identity scope. Supplying
          // the same invocation key models a redelivery of this one job.
          invocationKey: stableInvocationKey,
        },
        async () => {
          physicalProviderCalls += 1;
          return {
            text: responseText,
            responseId: "qa-daily-brief-response-1",
            modelVersion: "gemini-2.5-flash-qa",
            usageMetadata: {
              promptTokenCount: 8,
              candidatesTokenCount: 4,
              totalTokenCount: 12,
            },
          } as never;
        },
        {
          store,
          spool,
          validateOwnership: options.validateOwnership ?? (async () => undefined),
          recordUsage: async (input) => {
            usageAttempts += 1;
            if (options.failFirstLedgerWrite && usageAttempts === 1) {
              throw new Error("fixture ledger unavailable after provider response");
            }
            ledger.push(input as unknown as Record<string, unknown>);
            return { id: ledger.length, sourceEventId: input.sourceEventId };
          },
        },
      ),
    // Production telemetry is already settled by the receipt boundary above.
    // Keep operational telemetry out of this DB-free fixture.
    logCostTelemetry: async () => undefined,
    logFailedProviderAttempt: async () => undefined,
  };

  return {
    date,
    rows,
    store,
    spool,
    ledger,
    get physicalProviderCalls() {
      return physicalProviderCalls;
    },
    get usageAttempts() {
      return usageAttempts;
    },
    dependencies,
  };
}

test("actual daily-brief service settles mocked provider output and retrieves stored output", async () => {
  const fixture = createFixture();

  const generated = await generateDailyBrief(
    71,
    23,
    fixture.date,
    false,
    fixture.dependencies,
  );

  assert.equal(generated?.todayFocus.type, "content");
  assert.equal(fixture.rows.get(fixture.date)?.status, "generated");
  assert.equal(fixture.ledger.length, 1);
  assert.equal(fixture.ledger[0]?.unitCount, 12);
  assert.equal(fixture.ledger[0]?.sourceEventId?.toString().startsWith("provider-attempt:"), true);

  const sourceEventId = [...fixture.store.rows.keys()][0];
  assert.ok(sourceEventId);
  const receipt = fixture.store.rows.get(sourceEventId);
  assert.equal(receipt?.status, "accounted");
  assert.equal(receipt?.providerRequestId, "qa-daily-brief-response-1");
  assert.equal(receipt?.responseUsage?.unitCount, 12);

  // Retrieval is the service's generated-row short circuit, not a second
  // provider call. This also verifies the output fixture is actually stored.
  const retrieved = await generateDailyBrief(
    71,
    23,
    fixture.date,
    false,
    fixture.dependencies,
  );
  assert.deepEqual(retrieved, generated);
  assert.equal(fixture.store.rows.size, 1);
});

test("post-provider accounting failure is terminal and replay does not resubmit", async () => {
  const fixture = createFixture({
    stableInvocationKey: "qa:daily-brief:accounting-failure",
    failFirstLedgerWrite: true,
  });

  await assert.rejects(
    generateDailyBrief(71, 23, fixture.date, false, fixture.dependencies),
    (error: unknown) =>
      (error as { code?: string })?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );

  const sourceEventId = [...fixture.store.rows.keys()][0];
  assert.ok(sourceEventId);
  assert.equal(fixture.store.rows.get(sourceEventId)?.status, "accounting_failed");
  assert.equal(fixture.physicalProviderCalls, 1);
  assert.equal(fixture.usageAttempts, 1);
  assert.equal(fixture.ledger.length, 0);

  await assert.rejects(
    generateDailyBrief(71, 23, fixture.date, true, fixture.dependencies),
    (error: unknown) =>
      (error as { code?: string })?.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(fixture.physicalProviderCalls, 1, "accounting failure must not replay the provider");
  assert.equal(fixture.usageAttempts, 1);
});

test("pre-provider cancellation fails admission with zero receipt, usage, or provider call", async () => {
  const fixture = createFixture({
    stableInvocationKey: "qa:daily-brief:cancelled",
    validateOwnership: async () => {
      throw Object.assign(
        new Error("fixture job cancelled before provider admission"),
        { code: "PROVIDER_ADMISSION_CANCELLED" },
      );
    },
  });

  await assert.rejects(
    generateDailyBrief(71, 23, fixture.date, false, fixture.dependencies),
    /cancelled before provider admission/,
  );

  assert.equal(fixture.physicalProviderCalls, 0);
  assert.equal(fixture.store.rows.size, 0);
  assert.equal(fixture.usageAttempts, 0);
  assert.equal(fixture.ledger.length, 0);
  assert.equal(fixture.rows.get(fixture.date)?.status, "failed");
});

test("malformed provider output is rejected after the paid response is accounted", async () => {
  const fixture = createFixture({
    stableInvocationKey: "qa:daily-brief:malformed-output",
    responseText: JSON.stringify({ todayFocus: { type: "content" } }),
  });

  await assert.rejects(
    generateDailyBrief(71, 23, fixture.date, false, fixture.dependencies),
    /Gemini returned invalid brief shape/,
  );

  assert.equal(fixture.physicalProviderCalls, 1);
  assert.equal(fixture.ledger.length, 1);
  const sourceEventId = [...fixture.store.rows.keys()][0];
  assert.ok(sourceEventId);
  assert.equal(fixture.store.rows.get(sourceEventId)?.status, "accounted");
  assert.equal(fixture.rows.get(fixture.date)?.status, "failed");
  assert.equal(fixture.rows.get(fixture.date)?.sectionsJson, undefined);
});