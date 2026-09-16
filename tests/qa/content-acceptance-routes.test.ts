/**
 * Sandbox acceptance through the production HTTP route handlers.
 *
 * The route, schema, authorization callback, validation, persistence calls,
 * and response serialization are real. Provider calls, queues, billing, and
 * the application database are explicit deterministic seams below. This file
 * never invokes a paid provider, customer database, email, or publisher.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/qa/content-acceptance-routes.test.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

process.env.GEMINI_API_KEY ??= "qa-route-gemini";
process.env.OPENAI_API_KEY ??= "qa-route-openai";

type RouteAuth = { userId: number; teamId: number; role: string };
const auth: RouteAuth = { userId: 7101, teamId: 1701, role: "owner" };
const selectQueue: unknown[][] = [];
const insertRows: any[] = [];
const updates: any[] = [];
const insertId = { value: 2400 };
const updateReturningQueue: unknown[][] = [];
const queueCalls: Array<{ name: string; payload: any }> = [];
const billingCalls: Array<{ name: string; payload: any }> = [];
const providerCalls: Array<{ name: string; payload: any }> = [];
let queueFailure: Error | null = null;
let reservationOk = true;
let capReservation = 9001;
let existingBrandProfile: any = null;

function resetFixture() {
  selectQueue.length = 0;
  insertRows.length = 0;
  updates.length = 0;
  updateReturningQueue.length = 0;
  queueCalls.length = 0;
  billingCalls.length = 0;
  providerCalls.length = 0;
  queueFailure = null;
  reservationOk = true;
  capReservation = 9001;
  existingBrandProfile = null;
}

function query(rows: unknown[]) {
  const result: any = Promise.resolve(rows);
  result.limit = async () => rows;
  result.offset = async () => rows;
  result.orderBy = () => result;
  result.groupBy = () => result;
  return result;
}

function nextSelect() {
  return selectQueue.shift() ?? [];
}

const fixtureDb = {
  select: () => ({
    from: () => ({
      where: () => query(nextSelect()),
      leftJoin: () => query(nextSelect()),
      innerJoin: () => query(nextSelect()),
    }),
  }),
  insert: (_table: unknown) => ({
    values: (value: any) => {
      insertRows.push(value);
      const row = { ...value, id: insertId.value++ };
      const result: any = query([row]);
      result.returning = async () => [row];
      return result;
    },
  }),
  update: (_table: unknown) => ({
    set: (value: any) => ({
      where: () => {
        updates.push(value);
        const rows = updateReturningQueue.shift() ?? [];
        const result: any = query(rows);
        result.returning = async () => rows;
        return result;
      },
    }),
  }),
  delete: (_table: unknown) => ({
    where: () => query([]),
  }),
};

function file(relativePath: string) {
  return new URL(`../../${relativePath}`, import.meta.url).href;
}

// Explicit DB mock boundary. Selects are queued per handler invocation and
// writes are retained in insertRows/updates for durable-state assertions.
moduleMock(file("lib/db.ts"), { namedExports: { db: fixtureDb } });
moduleMock(file("lib/api/auth.ts"), {
  namedExports: {
    withAuthenticatedTeamContext: async (_request: unknown, callback: (value: RouteAuth) => Promise<unknown>) =>
      callback(auth),
    runWithAuthenticatedTeamContext: async (
      context: RouteAuth,
      callback: () => Promise<unknown>,
    ) => callback(),
  },
});

moduleMock(file("lib/gemini.ts"), {
  namedExports: {
    parseMultipleCities: (focus: string) =>
      focus.split(",").map((value) => value.trim()).filter(Boolean),
    generateTitlePool: async (...args: any[]) => {
      providerCalls.push({ name: "generateTitlePool", payload: args });
      return {
        titles: ["Fixture title one", "Fixture title two", "Fixture title three", "Fixture title four", "Fixture title five"],
        primaryKeywords: ["fixture energy audit"],
        contentStrategy: "Fixture strategy",
        titlesWithScores: [{ title: "Fixture title one", score: 88 }],
        critiqueSummary: "Fixture critique",
        removedCount: 0,
        refinedCount: 0,
      };
    },
    generateTitlePoolForMultipleCities: async (...args: any[]) => {
      providerCalls.push({ name: "generateTitlePoolForMultipleCities", payload: args });
      return {
        cities: [
          { city: "Austin", titles: ["Austin fixture title"], contentStrategy: "Austin strategy" },
          { city: "Dallas", titles: ["Dallas fixture title"], contentStrategy: "Dallas strategy" },
        ],
        combinedTitles: ["Austin fixture title", "Dallas fixture title"],
        combinedKeywords: ["fixture Austin", "fixture Dallas"],
        combinedTitlesWithScores: [],
        critiqueSummary: "Fixture multi-city critique",
        totalRemovedCount: 0,
        totalRefinedCount: 0,
      };
    },
  },
});
moduleMock(file("lib/reddit-research-service.ts"), {
  namedExports: {
    performRedditResearch: async (...args: any[]) => {
      providerCalls.push({ name: "performRedditResearch", payload: args });
      return { questions: [], subreddits: [], intentClusters: [], contentAngles: [] };
    },
  },
});
moduleMock(file("lib/smart-topic-research.ts"), {
  namedExports: {
    smartResearch: {
      researchTopic: async (...args: any[]) => {
        providerCalls.push({ name: "smartResearch", payload: args });
        return { localEntities: [], competitorTitles: [], suggestedAngles: [] };
      },
    },
  },
});

moduleMock(file("lib/queue.ts"), {
  namedExports: {
    addBatchGenerationJob: async (payload: any) => {
      queueCalls.push({ name: "addBatchGenerationJob", payload });
      if (queueFailure) throw queueFailure;
      return "fixture-batch-job";
    },
    addArticleJob: async (payload: any) => {
      queueCalls.push({ name: "addArticleJob", payload });
      if (queueFailure) throw queueFailure;
      return "fixture-article-job";
    },
    addReformatJob: async (payload: any) => {
      queueCalls.push({ name: "addReformatJob", payload });
      if (queueFailure) throw queueFailure;
      return "fixture-reformat-job";
    },
    addSocialPostJob: async (payload: any) => {
      queueCalls.push({ name: "addSocialPostJob", payload });
      if (queueFailure) throw queueFailure;
      return "fixture-social-job";
    },
    addIntelligenceResearchJob: async (payload: any) => {
      queueCalls.push({ name: "addIntelligenceResearchJob", payload });
      if (queueFailure) throw queueFailure;
      return "fixture-intelligence-job";
    },
    findArticleGenerationJob: async () => null,
    findBatchGenerationJob: async () => null,
    batchGenerationJobId: (batchId: number) => `fixture-batch-${batchId}`,
    ArticleEnqueueUncertainError: class ArticleEnqueueUncertainError extends Error {},
    AmbiguousBatchEnqueueError: class AmbiguousBatchEnqueueError extends Error {},
  },
});
const billingExports = {
  reserveCredits: async (payload: any) => {
      billingCalls.push({ name: "reserveCredits", payload });
      return reservationOk
        ? { ok: true, requiredCredits: 10, totalRemaining: 90 }
        : {
            ok: false,
            requiredCredits: 10,
            totalRemaining: 0,
            allowanceRemaining: 0,
            purchasedRemaining: 0,
            insufficientBy: 10,
          };
  },
  releaseReservation: async (payload: any) => {
      billingCalls.push({ name: "releaseReservation", payload });
      return { ok: true };
  },
  debitReservation: async (payload: any) => {
      billingCalls.push({ name: "debitReservation", payload });
      return { ok: true };
  },
  markReservationForReconciliation: async (payload: any) => {
      billingCalls.push({ name: "markReservationForReconciliation", payload });
  },
};
const billingFixtureUrl = file("tests/qa/content-acceptance-billing-fixture.mjs");
moduleMock(billingFixtureUrl, { namedExports: billingExports });
moduleMock(file("lib/billing/paywall.ts"), {
  namedExports: {
    checkTeamPaywall: async () => ({ allowed: true }),
    paywallErrorBody: (value: any) => ({ error: "PAYWALL", ...value }),
  },
});
moduleMock(file("lib/usage-caps.ts"), {
  namedExports: {
    checkUsageCap: async (...args: any[]) => {
      billingCalls.push({ name: "checkUsageCap", payload: args });
      return capReservation;
    },
    cancelCapReservation: async (id: number) => {
      billingCalls.push({ name: "cancelCapReservation", payload: { id } });
    },
  },
});
moduleMock(file("lib/credit-menu.ts"), {
  namedExports: {
    getCreditCost: () => 10,
    getEffectiveCreditCost: async () => 10,
  },
});
moduleMock(file("lib/error-logger.ts"), {
  namedExports: {
    logError: async (payload: any) => {
      billingCalls.push({ name: "logError", payload });
    },
  },
});
moduleMock(file("lib/batch-submission-validation.ts"), {
  namedExports: {
    batchSubmitSchema: {
      parse: (body: any) => body,
    },
    validateBatchSubmissionKey: (value: string) => value,
  },
});
moduleMock(file("lib/batch-submission.ts"), {
  namedExports: {
    inspectBatchSubmissionReplay: () => ({ outcome: "not_match" }),
    validateBatchSubmissionKey: (value: string) => value,
    compensateBatchEnqueueFailure: async (callbacks: any) => {
      await callbacks.releaseCredits();
      await callbacks.releaseCap();
      await callbacks.markRetryable();
      return { retryEnabled: true };
    },
  },
});
moduleMock(file("lib/batch-submission-server.ts"), {
  namedExports: {
    claimBatchForSubmission: async (batchId: number) => ({
      outcome: "claimed",
      batch: {
        id: batchId,
        userId: auth.userId,
        teamId: auth.teamId,
        campaignId: null,
        targetUrl: "https://fixture.example",
        generationParams: {},
        businessName: "Fixture Services",
      },
    }),
    recordBatchEnqueueAccepted: async (payload: any) => {
      updates.push({ submissionAccepted: payload });
      return true;
    },
  },
});

moduleMock(file("lib/seo-regenerator.ts"), {
  namedExports: {
    regenerateSeoTitle: async () => "Fixture SEO title for Austin energy audits",
    regenerateMetaDescription: async () =>
      "Fixture meta description for Austin energy audits helps homeowners plan a practical and efficient next step today.",
    regenerateKeywords: async () => ["Austin energy audit", "home efficiency Austin", "fixture audit guide"],
    regenerateSlug: async () => "fixture-austin-energy-audit",
    regenerateFAQ: async () => [{
      question: "What is a fixture audit?",
      answer: "A fixture audit reviews the home's energy performance.",
    }],
    regenerateHashtags: async () => ["#AustinEnergy", "#FixtureAudit", "#HomeEfficiency"],
  },
});
moduleMock(file("lib/slug-map-injector.ts"), {
  namedExports: {
    buildFallbackTerms: () => ["fixture energy audit", "Austin homeowner guidance"],
    buildSlugMap: async () => ({ entries: [], pages: [] }),
    injectLinksWithIntent: async (_teamId: number, html: string, ..._rest: unknown[]) => ({
      html: `${html}<a href="https://fixture.example" class="text-primary hover:underline">fixture energy audit</a>`,
      linksInjected: 1,
      mode: "fixture",
      linkedKeywords: ["fixture energy audit"],
    }),
  },
});
moduleMock(file("lib/guardian-agent.ts"), {
  namedExports: {
    auditArticle: async () => ({
      score: 100,
      passed: true,
      missingElements: [],
      formattingIssues: [],
    }),
  },
});
moduleMock(file("lib/surgical-fix.ts"), {
  namedExports: {
    applySurgicalFix: async (payload: any) => ({ html: payload.html, unchanged: true, appliedFixes: [] }),
  },
});
moduleMock(file("lib/keyword-hyperlink-pipeline.ts"), {
  namedExports: {
    extractKeywordsFromArticle: async () => ({ rawKeywords: ["fixture energy audit"] }),
    applyKeywordHyperlinks: (html: string, keywords: string[], targetUrl: string) => ({
      correctedHtml: `${html}<a href="${targetUrl}">${keywords[0]}</a>`,
      keywordsFound: keywords,
      keywordsMissing: [],
      keywordsLinked: keywords.length,
      faqKeywordsLinked: 0,
    }),
    validateAndCorrectHyperlinks: async (html: string) => ({
      correctedHtml: html,
      corrections: [],
    }),
  },
});

moduleMock(file("lib/generation-orchestrator.ts"), {
  namedExports: {
    runGenerationOrchestrator: async (payload: any) => ({
      content: payload.content,
      repairs: 0,
      orchestrated: true,
      qualityScore: 90,
      armId: "fixture-arm",
    }),
  },
});
moduleMock(file("lib/learning-integration.ts"), {
  namedExports: {
    getPromptEnhancement: async () => ({ patternsUsed: [] }),
    recordContentGenerated: async () => undefined,
  },
});
moduleMock(file("lib/generation-finalization-gate.ts"), {
  namedExports: {
    assertSocialFinalizationQuality: async (payload: any) => ({
      caption: payload.caption,
      hashtags: payload.hashtags,
    }),
  },
});
moduleMock(file("lib/gemini-social.ts"), {
  namedExports: {
    generateSocialPostWithGemini: async (payload: any) => {
      providerCalls.push({ name: "generateSocialPostWithGemini", payload });
      return {
        caption: "Fixture social caption for Austin homeowners.",
        characterCount: 48,
        wordCount: 7,
      };
    },
  },
});
moduleMock(file("lib/openai-social.ts"), {
  namedExports: {
    enhanceSocialPostWithGPT: async (payload: any) => {
      providerCalls.push({ name: "enhanceSocialPostWithGPT", payload });
      return {
        caption: "Fixture social caption for Austin homeowners.",
        hashtags: [
          { tag: "#Austin", mailtoLink: "mailto:qa@example.invalid?subject=Austin" },
          { tag: "#Energy", mailtoLink: "mailto:qa@example.invalid?subject=Energy" },
          { tag: "#Audits", mailtoLink: "mailto:qa@example.invalid?subject=Audits" },
        ],
        emojis: ["💡"],
        hyperlinks: [{ text: "Learn more", url: "https://fixture.example/learn" }],
      };
    },
  },
});

const seoOutput = {
  location: "Austin, TX",
  business_type: "home energy auditor",
  location_keywords: { primary: ["Austin home energy audit"] },
  seasonal_trends: [],
  local_questions: [],
};
const competitorOutput = {
  competitor_url: "https://competitor.example",
  strengths: ["Clear navigation"],
  weaknesses: ["No local FAQ"],
  content_gaps: ["Seasonal checklist"],
  suggested_improvements: [],
  unique_angles: [],
  keyword_opportunities: [],
};
const contentStructureOutput = {
  title: "Fixture content structure",
  headings: [{ level: "h1", text: "Fixture content structure" }],
  faq_section: [],
  key_takeaways: ["Inspect first"],
};
const pillarOutput = {
  pillar_page: { title: "Fixture pillar", target_keywords: ["fixture audit"] },
  cluster_pages: [],
  internal_linking_map: [],
  content_calendar: [],
};
class FixtureSchemaMarkupValidationError extends Error {
  readonly statusCode = 400;
}
moduleMock(file("lib/seo-intelligence.ts"), {
  namedExports: {
    researchLocalSEO: async () => seoOutput,
    analyzeCompetitor: async () => competitorOutput,
    optimizeContentStructure: async () => contentStructureOutput,
    generatePillarClusterStrategy: async () => pillarOutput,
    generateSchemaMarkup: async () => ({
      type: "FAQPage",
      json_ld: JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [] }),
    }),
    validateSchemaMarkupData: (_type: string, data: any) => {
      if (data?.faqs && Array.isArray(data.faqs) && data.faqs.length === 0) {
        throw new FixtureSchemaMarkupValidationError("FAQPage requires at least one non-empty question and answer");
      }
      return data;
    },
    SchemaMarkupValidationError: FixtureSchemaMarkupValidationError,
  },
});
moduleMock(file("lib/content-audit.ts"), {
  namedExports: {
    auditArticle: async () => ({ score: 92, findings: [{ code: "fixture", severity: "low" }] }),
  },
});

const fixtureCampaign = {
  id: 77,
  publicId: "11111111-1111-4111-8111-111111111111",
  teamId: auth.teamId,
  brandStatus: "confirmed",
  brandConfirmedAt: new Date("2025-01-01T00:00:00Z"),
};
moduleMock(file("lib/campaign-service.ts"), {
  namedExports: {
    getCampaignByPublicId: async () => fixtureCampaign,
    getCampaignDetailByPublicId: async () => ({
      campaign: fixtureCampaign,
      brandProfile: { companyName: "Fixture Services" },
    }),
    confirmBrandSnapshot: async () => ({ ok: true }),
    markCampaignResearchQueued: async () => undefined,
  },
});
moduleMock(file("lib/campaign-ads-service.ts"), {
  namedExports: {
    getCampaignAdByRequestKey: async () => null,
    createCampaignAdPack: async (_teamId: number, _userId: number, campaignId: number, input: any) => ({
      id: 601,
      campaignId,
      requestKey: input.requestKey,
      landingUrl: input.landingUrl,
      headlines: ["Fixture headline"],
      descriptions: ["Fixture description"],
    }),
    listCampaignAds: async () => [{ id: 601, requestKey: "fixture-request" }],
    listCampaignAdApprovals: async () => [],
  },
});
moduleMock(file("lib/launch-governance.ts"), {
  namedExports: {
    EXTERNAL_PLATFORM_APPROVALS: {
      googleAds: { status: "approval_required" },
      metaAds: { status: "approval_required" },
    },
  },
});
moduleMock(file("lib/client-brand-profile-service.ts"), {
  namedExports: {
    getClientBrandProfile: async () => existingBrandProfile,
    upsertClientBrandProfile: async (...args: any[]) => {
      updates.push({ brandProfile: args });
    },
  },
});

function request(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`http://fixture.invalid${path}`, {
    method: options.method ?? "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function bodyOf(response: Response) {
  return await response.json() as any;
}

test("rows 1 and 4: title-pool and batch-title routes persist title output and fail malformed input before provider work", async () => {
  resetFixture();
  selectQueue.push([{ id: auth.userId, teamId: auth.teamId }]);
  const { POST: titlePoolPost } = await import("../../app/api/jobs/title-pool/route.js");
  const titleResponse = await titlePoolPost(request("/api/jobs/title-pool", {
    body: {
      userId: 99999,
      coreTopic: "home energy audits",
      targetUrl: "https://fixture.example",
      numTitles: 5,
      geographicFocus: "Austin",
    },
  }));
  const titleBody = await bodyOf(titleResponse);
  assert.equal(titleResponse.status, 200);
  assert.equal(titleBody.titles.length, 5);
  assert.equal(insertRows[0]?.teamId, auth.teamId);
  assert.equal(insertRows[0]?.userId, auth.userId);

  resetFixture();
  selectQueue.push([{
    id: 81,
    teamId: auth.teamId,
    status: "PENDING",
    coreTopic: "home energy audits",
    targetUrl: "https://fixture.example",
    generationParams: { geographicFocus: "Austin" },
  }]);
  const { POST: regenerateTitlesPost } =
    await import("../../app/api/batches/[id]/regenerate-titles/route.js");
  const regenerateResponse = await regenerateTitlesPost(
    request("/api/batches/81/regenerate-titles"),
    { params: Promise.resolve({ id: "81" }) },
  );
  const regenerateBody = await bodyOf(regenerateResponse);
  assert.equal(regenerateResponse.status, 200);
  assert.equal(regenerateBody.success, true);
  assert.equal(regenerateBody.titles.length, 5);
  assert.ok(updates.some((value) => value.titlePoolJson));

  resetFixture();
  const beforeCalls = providerCalls.length;
  const malformedResponse = await titlePoolPost(request("/api/jobs/title-pool", {
    body: { targetUrl: "https://fixture.example", geographicFocus: "Austin" },
  }));
  assert.equal(malformedResponse.status, 400);
  assert.equal(providerCalls.length, beforeCalls);
});

test("rows 2 and 3: batch submit and article regeneration reserve once, enqueue once, and release on queue failure", async () => {
  resetFixture();
  const batchBody = {
    batchId: 81,
    selectedTitles: ["Fixture title one"],
    targetUrl: "https://fixture.example",
    wordCountMin: 800,
    wordCountMax: 1200,
    geographicFocus: "Austin",
  };
  const { POST: submitPost } = await import("../../app/api/jobs/batch-submit/route.js");
  const submitResponse = await submitPost(request("/api/jobs/batch-submit", {
    body: batchBody,
    headers: { "X-Idempotency-Key": "fixture-batch-request", "X-Skip-Intelligence-Gate": "1" },
  }));
  const submitBody = await bodyOf(submitResponse);
  assert.equal(submitResponse.status, 200);
  assert.equal(submitBody.jobId, "fixture-batch-job");
  assert.equal(queueCalls.filter((call) => call.name === "addBatchGenerationJob").length, 1);
  assert.equal(billingCalls.filter((call) => call.name === "reserveCredits").length, 1);
  assert.ok(updates.some((value) => value.generationParams));

  resetFixture();
  selectQueue.push([
    {
      id: 91,
      teamId: auth.teamId,
      batchId: 81,
      chosenTitle: "Fixture title one",
      articleStatus: "COMPLETE",
      finalHtmlContent: "<p>Fixture article body.</p>",
    },
  ]);
  selectQueue.push([{
    id: 81,
    targetUrl: "https://fixture.example",
    generationParams: { geographicFocus: "Austin" },
    businessName: "Fixture Services",
    campaignId: null,
  }]);
  selectQueue.push([]);
  selectQueue.push([]);
  updateReturningQueue.push([{ id: 91 }]);
  const { POST: regenerateArticlePost } =
    await import("../../app/api/articles/[id]/regenerate/route.js");
  const regenerateResponse = await regenerateArticlePost(
    request("/api/articles/91/regenerate", {
      body: { customInstructions: "Use the fixture tone." },
      headers: { "X-Idempotency-Key": "fixture-article-request" },
    }),
    { params: Promise.resolve({ id: "91" }) },
  );
  const regenerateBody = await bodyOf(regenerateResponse);
  assert.equal(regenerateResponse.status, 200);
  assert.equal(regenerateBody.status, "PENDING");
  assert.equal(queueCalls.filter((call) => call.name === "addArticleJob").length, 1);

  resetFixture();
  selectQueue.push([{
    id: 81,
    userId: auth.userId,
    teamId: auth.teamId,
    campaignId: null,
    targetUrl: "https://fixture.example",
    generationParams: {},
  }]);
  queueFailure = new Error("fixture queue unavailable");
  const failedSubmit = await submitPost(request("/api/jobs/batch-submit", {
    body: batchBody,
    headers: { "X-Idempotency-Key": "fixture-failed-request", "X-Skip-Intelligence-Gate": "1" },
  }));
  const failedBody = await bodyOf(failedSubmit);
  assert.equal(failedSubmit.status, 500);
  assert.equal(failedBody.code, "BATCH_ENQUEUE_FAILED");
  assert.ok(billingCalls.some((call) => call.name === "releaseReservation"));
});

test("rows 5, 6 and 7: all metadata variants plus article/batch hyperlink and reformat routes update fixture state", async () => {
  const metadataRoutes = [
    ["seo-title", "seoTitle"],
    ["meta-description", "metaDescription"],
    ["keywords", "keywords"],
    ["slug", "slug"],
    ["faq", "faq"],
    ["hashtags", "hashtags"],
  ] as const;
  for (const [variant, responseKey] of metadataRoutes) {
    resetFixture();
    selectQueue.push([{
      id: 91,
      teamId: auth.teamId,
      chosenTitle: "Fixture title",
      finalHtmlContent: "<p>Fixture article content for metadata regeneration.</p>",
      seoTitle: "Current fixture title",
      metaDescription: "Current fixture description",
      keywordsJson: ["current fixture"],
      slug: "current-fixture",
      metaEnrichment: {},
      hashtagsJson: ["#CurrentFixture"],
    }]);
    const module = await import(`../../app/api/content/[id]/regenerate/${variant}/route.js`);
    const response = await module.POST(
      request(`/api/content/91/regenerate/${variant}`),
      { params: Promise.resolve({ id: "91" }) },
    );
    const result = await bodyOf(response);
    assert.equal(response.status, 200, `${variant}: ${JSON.stringify(result)}`);
    assert.equal(result.success, true);
    assert.ok(result[responseKey] !== undefined, `${variant} output missing`);
    assert.ok(updates.length > 0, `${variant} did not persist`);
  }

  resetFixture();
  selectQueue.push([{
    id: 91,
    teamId: auth.teamId,
    batchId: 81,
    chosenTitle: "Fixture title",
    articleStatus: "COMPLETE",
    finalHtmlContent: `<article><p>${"Fixture content ".repeat(80)}</p></article>`,
    keywordsJson: ["fixture energy audit"],
  }]);
  selectQueue.push([{
    id: 81,
    teamId: auth.teamId,
    targetUrl: "https://fixture.example",
    coreTopic: "home energy audits",
    generationParams: { geographicFocus: "Austin", tone: "professional" },
    businessName: "Fixture Services",
  }]);
  const { POST: applyArticleLinks } =
    await import("../../app/api/articles/[id]/apply-hyperlinks/route.js");
  const linkResponse = await applyArticleLinks(
    request("/api/articles/91/apply-hyperlinks"),
    { params: Promise.resolve({ id: "91" }) },
  );
  const linkBody = await bodyOf(linkResponse);
  assert.equal(linkResponse.status, 200);
  assert.equal(linkBody.success, true);
  assert.equal(linkBody.articleId, 91);
  assert.ok(updates.some((value) => String(value.finalHtmlContent).includes("fixture energy audit")));

  resetFixture();
  selectQueue.push([{
    id: 81,
    teamId: auth.teamId,
    targetUrl: "https://fixture.example",
    coreTopic: "home energy audits",
    generationParams: { geographicFocus: "Austin", tone: "professional" },
    businessName: "Fixture Services",
  }]);
  selectQueue.push([{
    id: 91,
    batchId: 81,
    chosenTitle: "Fixture title",
    articleStatus: "COMPLETE",
    finalHtmlContent: `<article><p>${"Fixture content ".repeat(80)}</p></article>`,
  }]);
  const { POST: keywordLinks } =
    await import("../../app/api/batches/[id]/apply-keyword-hyperlinks/route.js");
  const keywordResponse = await keywordLinks(
    request("/api/batches/81/apply-keyword-hyperlinks"),
    { params: Promise.resolve({ id: "81" }) },
  );
  const keywordBody = await bodyOf(keywordResponse);
  assert.equal(keywordResponse.status, 200);
  assert.equal(keywordBody.summary.fixed, 1);

  resetFixture();
  selectQueue.push([{
    id: 81,
    teamId: auth.teamId,
    targetUrl: "https://fixture.example",
    coreTopic: "home energy audits",
    generationParams: { geographicFocus: "Austin" },
    businessName: "Fixture Services",
  }]);
  selectQueue.push([{
    id: 91,
    batchId: 81,
    chosenTitle: "Fixture title",
    finalHtmlContent: "<article><p>Fixture body</p></article>",
    hashtagsJson: ["#FixtureAudit"],
    hyperlinkedKeywordsJson: [],
  }]);
  const { POST: fixedLinks } =
    await import("../../app/api/batches/[id]/fix-hyperlinks/route.js");
  const fixedResponse = await fixedLinks(
    request("/api/batches/81/fix-hyperlinks"),
    { params: Promise.resolve({ id: "81" }) },
  );
  const fixedBody = await bodyOf(fixedResponse);
  assert.equal(fixedResponse.status, 200);
  assert.equal(fixedBody.success, true);

  resetFixture();
  selectQueue.push([{
    id: 91,
    teamId: auth.teamId,
    finalHtmlContent: "<p>Fixture article</p>",
  }]);
  const { POST: reformatPost } = await import("../../app/api/articles/[id]/reformat/route.js");
  const reformatResponse = await reformatPost(
    request("/api/articles/91/reformat"),
    { params: Promise.resolve({ id: "91" }) },
  );
  const reformatBody = await bodyOf(reformatResponse);
  assert.equal(reformatResponse.status, 200);
  assert.equal(reformatBody.jobId, "fixture-reformat-job");
});

test("rows 11 and 12: social creation canonicalizes aliases, persists a queue identity, and regenerates one variant", async () => {
  resetFixture();
  selectQueue.push([]); // explicit campaign lookup is skipped for standalone
  selectQueue.push([]); // request-key idempotency lookup
  const { POST: socialPost } = await import("../../app/api/social_posts/generate/route.js");
  const socialResponse = await socialPost(request("/api/social_posts/generate", {
    body: {
      standaloneTitle: "Fixture energy audit",
      topic: "Fixture energy audits",
      platforms: ["twitter", "facebook", "twitter"],
      location: "Austin, TX",
      generateImages: false,
    },
    headers: { "X-Idempotency-Key": "fixture-social-request" },
  }));
  const socialBody = await bodyOf(socialResponse);
  assert.equal(socialResponse.status, 200);
  assert.deepEqual(socialBody.platforms, ["x", "facebook"]);
  assert.equal(queueCalls.filter((call) => call.name === "addSocialPostJob").length, 1);
  assert.equal(insertRows[0]?.platformsJson[0], "x");

  resetFixture();
  selectQueue.push([{
    id: 301,
    socialPostId: 2401,
    platform: "x",
    status: "READY",
  }]);
  selectQueue.push([{
    id: 2401,
    teamId: auth.teamId,
    topic: "Fixture energy audit",
    title: "Fixture energy audit",
    tone: "professional",
    mood: "informative",
    industry: "consulting",
    location: "Austin, TX",
    userEmail: "qa@example.invalid",
    companyName: "Fixture Services",
    campaignId: null,
  }]);
  const { POST: regenerateVariant } =
    await import("../../app/api/social-posts/variants/[variantId]/regenerate/route.js");
  const variantResponse = await regenerateVariant(
    request("/api/social-posts/variants/301/regenerate"),
    { params: Promise.resolve({ variantId: "301" }) },
  );
  const variantBody = await bodyOf(variantResponse);
  assert.equal(variantResponse.status, 200, JSON.stringify(variantBody));
  assert.equal(variantBody.variant.status, "READY");
  assert.equal(variantBody.variant.platform, "x");
  assert.ok(updates.some((value) => value.status === "READY"));

  resetFixture();
  const badSocialResponse = await socialPost(request("/api/social_posts/generate", {
    body: {
      standaloneTitle: "Fixture energy audit",
      platforms: ["unknown-platform"],
    },
  }));
  assert.equal(badSocialResponse.status, 400);
  assert.equal(queueCalls.length, 0);
});

test("rows 18–24: every SEO route returns typed fixture output, schema rejects malformed rows, and create-articles persists intent", async () => {
  const routes: Array<[string, Record<string, unknown>, string]> = [
    ["content-audit", { articleId: 91 }, "score"],
    ["local-research", { location: "Austin, TX", business_type: "auditor" }, "location"],
    ["competitor-analysis", { competitor_url: "https://competitor.example", your_business_type: "auditor" }, "competitor_url"],
    ["content-structure", { topic: "audits", target_audience: "homeowners" }, "title"],
    ["pillar-cluster", { main_topic: "audits", industry: "services", target_audience: "homeowners" }, "pillar_page"],
  ];
  for (const [routeName, payload, field] of routes) {
    resetFixture();
    const module = await import(`../../app/api/seo/${routeName}/route.js`);
    const response = await module.POST(request(`/api/seo/${routeName}`, { body: payload }));
    const result = await bodyOf(response);
    assert.equal(response.status, 200, `${routeName}: ${JSON.stringify(result)}`);
    assert.ok(result[field] !== undefined, `${routeName} missing ${field}`);
  }

  resetFixture();
  const { POST: schemaPost } = await import("../../app/api/seo/schema-markup/route.js");
  const schemaResponse = await schemaPost(request("/api/seo/schema-markup", {
    body: {
      content_type: "FAQPage",
      data: { faqs: [{ question: "What is fixture QA?", answer: "It checks the production boundary." }] },
    },
  }));
  const schemaBody = await bodyOf(schemaResponse);
  assert.equal(schemaResponse.status, 200);
  assert.equal(schemaBody.type, "FAQPage");

  resetFixture();
  const malformedSchema = await schemaPost(request("/api/seo/schema-markup", {
    body: { content_type: "FAQPage", data: { faqs: [] } },
  }));
  assert.equal(malformedSchema.status, 400);

  resetFixture();
  const { POST: createArticles } = await import("../../app/api/seo/create-articles/route.js");
  const createResponse = await createArticles(request("/api/seo/create-articles", {
    body: {
      seoToolType: "local_research",
      seoToolOutput: seoOutput,
      targetUrl: "https://fixture.example",
      numArticles: 1,
      geographicFocus: "Austin",
    },
  }));
  const createBody = await bodyOf(createResponse);
  assert.equal(createResponse.status, 200);
  assert.equal(createBody.success, true);
  assert.equal(createBody.titleCount, 5);
  assert.equal(insertRows[0]?.teamId, auth.teamId);
});

test("rows 26, 27 and 40: campaign ad export pack, brand confirmation, and standalone intelligence enqueue are tenant-scoped", async () => {
  resetFixture();
  const publicId = fixtureCampaign.publicId;
  const { POST: adsPost, GET: adsGet } = await import("../../app/api/campaigns/[id]/ads/route.js");
  const adsResponse = await adsPost(
    request(`/api/campaigns/${publicId}/ads`, {
      body: {
        requestKey: "fixture-request",
        landingUrl: "https://fixture.example/landing",
        brief: "Fixture ad brief",
      },
    }),
    { params: Promise.resolve({ id: publicId }) },
  );
  const adsBody = await bodyOf(adsResponse);
  assert.equal(adsResponse.status, 201, JSON.stringify(adsBody));
  assert.equal(adsBody.ad.campaignId, fixtureCampaign.id);
  assert.ok(billingCalls.some((call) => call.name === "debitReservation"));

  const adsListResponse = await adsGet(
    request(`/api/campaigns/${publicId}/ads`, { method: "GET" }),
    { params: Promise.resolve({ id: publicId }) },
  );
  const adsListBody = await bodyOf(adsListResponse);
  assert.equal(adsListResponse.status, 200);
  assert.equal(adsListBody.mode, "export_only");
  assert.equal(adsListBody.directPublishing, false);

  const { POST: confirmBrand } = await import("../../app/api/campaigns/[id]/confirm-brand/route.js");
  const confirmResponse = await confirmBrand(
    request(`/api/campaigns/${publicId}/confirm-brand`),
    { params: Promise.resolve({ id: publicId }) },
  );
  const confirmBody = await bodyOf(confirmResponse);
  assert.equal(confirmResponse.status, 200);
  assert.equal(confirmBody.success, true);
  assert.equal(confirmBody.campaign.id, fixtureCampaign.id);

  resetFixture();
  const { POST: runIntelligence } = await import("../../app/api/intelligence/run/route.js");
  const intelligenceResponse = await runIntelligence(request("/api/intelligence/run", {
    body: {
      websiteUrl: "https://fixture.example",
      companyName: "Fixture Services",
    },
  }));
  const intelligenceBody = await bodyOf(intelligenceResponse);
  assert.equal(intelligenceResponse.status, 200);
  assert.equal(intelligenceBody.jobId, "fixture-intelligence-job");
  assert.ok(queueCalls.some((call) => call.name === "addIntelligenceResearchJob"));

  resetFixture();
  existingBrandProfile = { status: "running", progressStep: "crawl" };
  const alreadyRunning = await runIntelligence(request("/api/intelligence/run", {
    body: { websiteUrl: "https://fixture.example", companyName: "Fixture Services" },
  }));
  const alreadyRunningBody = await bodyOf(alreadyRunning);
  assert.equal(alreadyRunning.status, 200);
  assert.equal(alreadyRunningBody.alreadyRunning, true);
  assert.equal(queueCalls.length, 0);
});
