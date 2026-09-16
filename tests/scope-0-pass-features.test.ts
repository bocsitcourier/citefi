/**
 * Scope 0 regression locks for the seven PASS rows in
 * reports/live-generation/masterinventory.json.
 *
 * This is an in-process unit suite. Provider-facing functions receive fixture
 * responses through module-boundary stubs; no provider SDK call, HTTP request,
 * queue, or database write is permitted by these tests.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks \
 *     --import tsx/esm --test tests/scope-0-pass-features.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

const geminiResponses: string[] = [];
const geminiPrompts: string[] = [];
const geminiRequests: any[] = [];
const geminiTelemetry: any[] = [];
const openAiResponses: string[] = [];
const openAiContexts: string[] = [];
const openAiRequests: any[] = [];
const openAiTelemetry: any[] = [];

// Replace provider packages and the accounting wrapper before any production
// provider module is imported. The fixture responses are deliberately
// deterministic and contain no customer or report data.
moduleMock("@google/genai", {
  namedExports: {
    GoogleGenAI: class FakeGoogleGenAI {
      readonly models = {
        generateContent: async (request: any) => {
          geminiRequests.push(request);
          const prompt = request?.contents?.[0]?.parts?.[0]?.text;
          if (typeof prompt === "string") geminiPrompts.push(prompt);
          const text = geminiResponses.shift();
          if (!text) throw new Error("No Gemini unit fixture configured");
          return {
            text,
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          };
        },
      };

      constructor(_options: unknown) {}
    },
  },
});

moduleMock("openai", {
  defaultExport: class FakeOpenAI {
    readonly chat = {
      completions: {
        create: async () => ({
          id: "scope0-openai-fixture",
          model: "scope0-unit-model",
          choices: [{ message: { content: "{}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      },
    };

    constructor(_options: unknown) {}
  },
});

const costTelemetryUrl = new URL("../lib/cost-telemetry.ts", import.meta.url).href;
moduleMock(costTelemetryUrl, {
  namedExports: {
    extractGeminiUsage: () => ({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    }),
    isProviderAccountingError: () => false,
    logCostTelemetry: async (context: unknown) => {
      geminiTelemetry.push(context);
    },
    logFailedProviderAttempt: async () => undefined,
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
      if (content === undefined) throw new Error("No OpenAI unit fixture configured");
      const fakeClient = {
        chat: {
          completions: {
            create: async (request: unknown) => {
              openAiRequests.push(request);
              return {
                id: "scope0-openai-fixture",
                model: "scope0-unit-model",
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

// SEO intelligence owns provider submission through this adapter. Replace that
// adapter, rather than loading the receipt core and its DB/Pool persistence
// imports, while retaining the real SEO parsing and validation code.
const geminiAdapterMock = {
  namedExports: {
    submitGeminiRequest: async (
      _request: unknown,
      _context: unknown,
      submit: () => Promise<unknown>,
    ) => await submit(),
  },
};
moduleMock(new URL("../lib/gemini", import.meta.url).href, geminiAdapterMock);

beforeEach(() => {
  geminiResponses.length = 0;
  geminiPrompts.length = 0;
  geminiRequests.length = 0;
  geminiTelemetry.length = 0;
  openAiResponses.length = 0;
  openAiContexts.length = 0;
  openAiRequests.length = 0;
  openAiTelemetry.length = 0;
});

test("SEO local research parses a stubbed Gemini response for the requested location", async () => {
  const { researchLocalSEO } = await import("../lib/seo-intelligence.js");
  geminiResponses.push(JSON.stringify({
    location: "Austin, TX",
    business_type: "home energy auditor",
    location_keywords: {
      primary: ["Austin home energy audit"],
      long_tail: ["home energy audit near Mueller"],
      neighborhood_specific: ["Mueller energy audit"],
      landmarks: ["Lady Bird Lake"],
    },
    seasonal_trends: [{
      season: "summer",
      keywords: ["cooling efficiency"],
      content_angles: ["prepare before peak heat"],
      peak_months: ["June", "July"],
    }],
    local_questions: [{
      question: "How much does an Austin energy audit cost?",
      search_intent: "transactional",
      difficulty: "medium",
      suggested_content_type: "service page",
    }],
    local_slang: [{
      term: "ATX",
      meaning: "Austin",
      usage_example: "Austin homeowners use ATX informally.",
    }],
    cultural_references: [{
      reference: "Austin heat",
      context: "long cooling season",
      content_opportunity: "summer preparation guide",
    }],
    trending_topics: [{
      topic: "home electrification",
      trend_score: 88,
      content_angle: "rebates and comfort",
      urgency: "high",
    }],
  }));

  const result = await researchLocalSEO({
    teamId: 42,
    location: "Austin, TX",
    business_type: "home energy auditor",
    core_topic: "home comfort",
  });

  assert.equal(result.location, "Austin, TX");
  assert.equal(result.local_questions[0]?.search_intent, "transactional");
  assert.equal(result.trending_topics[0]?.trend_score, 88);
  assert.match(geminiPrompts[0] ?? "", /Location: Austin, TX/);
  assert.match(geminiPrompts[0] ?? "", /Business Type: home energy auditor/);
  assert.equal(geminiRequests.length, 1);
  assert.equal(geminiRequests[0].config.responseMimeType, "application/json");
  assert.equal(geminiRequests[0].contents[0].role, "user");
  assert.equal(geminiTelemetry[0].operationType, "seo_analysis");
  assert.equal(geminiTelemetry[0].provider, "gemini");
  assert.equal(geminiTelemetry[0].teamId, 42);
});

test("SEO content structure parses a stubbed Gemini outline without a live call", async () => {
  const { optimizeContentStructure } = await import("../lib/seo-intelligence.js");
  geminiResponses.push(JSON.stringify({
    title: "Fixture energy audit guide",
    meta_description: "A concise fixture guide.",
    tldr: "Start with a professional audit.",
    headings: [
      { level: "h1", text: "Fixture energy audit guide" },
      { level: "h2", text: "What an audit measures", summary: "The key measurements." },
    ],
    faq_section: [{
      question: "What does an audit include?",
      answer: "It reviews the home's energy performance.",
    }],
    key_takeaways: ["Inspect first", "Prioritize repairs"],
    definition_boxes: [{
      term: "Energy audit",
      definition: "A review of energy use and loss.",
    }],
    schema_markup: [{
      type: "Article",
      json_ld: "{\"@type\":\"Article\"}",
    }],
  }));

  const result = await optimizeContentStructure({
    teamId: 42,
    topic: "home energy audits",
    target_audience: "Austin homeowners",
    word_count_target: 1200,
    include_faq: true,
    include_definitions: true,
  });

  assert.equal(result.headings[1]?.level, "h2");
  assert.equal(result.faq_section.length, 1);
  assert.deepEqual(result.key_takeaways, ["Inspect first", "Prioritize repairs"]);
  assert.match(geminiPrompts[0] ?? "", /Target Audience: Austin homeowners/);
});

test("SEO schema markup validates and builds all four supported PASS types", async () => {
  const {
    generateSchemaMarkup,
    SchemaMarkupValidationError,
    validateSchemaMarkupData,
  } = await import("../lib/seo-intelligence.js");

  const article = await generateSchemaMarkup({
    content_type: "Article",
    data: { title: "Fixture article", meta_description: "Fixture description" },
  });
  assert.equal(JSON.parse(article.json_ld)["@type"], "Article");

  const faqData = validateSchemaMarkupData("FAQPage", {
    faqs: [
      { question: " ", answer: "discarded" },
      { question: "  What is it? ", answer: "  A fixture answer. " },
    ],
  });
  assert.deepEqual(faqData.faqs, [{
    question: "What is it?",
    answer: "A fixture answer.",
  }]);
  const faq = await generateSchemaMarkup({ content_type: "FAQPage", data: faqData });
  assert.equal(JSON.parse(faq.json_ld).mainEntity[0].name, "What is it?");

  const howTo = await generateSchemaMarkup({
    content_type: "HowTo",
    data: {
      title: "Fixture steps",
      description: "Fixture instructions.",
      steps: [{ name: "  Inspect  ", text: "  Check the fixture. " }],
    },
  });
  assert.equal(JSON.parse(howTo.json_ld).step[0].text, "Check the fixture.");

  const localBusiness = await generateSchemaMarkup({
    content_type: "LocalBusiness",
    data: {
      name: "Fixture Services",
      address: {
        streetAddress: "1 Fixture Way",
        addressLocality: "Austin",
        addressRegion: "TX",
        postalCode: "78701",
      },
    },
  });
  const localJson = JSON.parse(localBusiness.json_ld);
  assert.equal(localJson.name, "Fixture Services");
  assert.equal(localJson.address.addressCountry, "US");

  assert.throws(
    () => validateSchemaMarkupData("FAQPage", { faqs: [{ question: "", answer: "" }] }),
    (error: unknown) =>
      error instanceof SchemaMarkupValidationError &&
      /at least one non-empty question/.test(error.message),
  );
});

test("SEO pillar-cluster planning parses a stubbed OpenAI strategy", async () => {
  const { generatePillarClusterStrategy } = await import("../lib/seo-intelligence.js");
  openAiResponses.push(JSON.stringify({
    pillar_page: {
      title: "Fixture pillar",
      description: "Fixture pillar description",
      target_keywords: ["fixture energy audit"],
      estimated_word_count: 2200,
      sections: ["Overview", "Next steps"],
    },
    cluster_pages: [{
      title: "Fixture checklist",
      description: "Fixture checklist description",
      target_keywords: ["fixture checklist"],
      estimated_word_count: 900,
      link_to_pillar: "Fixture pillar",
      subtopics: ["inspection"],
    }],
    internal_linking_map: [{
      from: "Fixture checklist",
      to: "Fixture pillar",
      anchor_text: "fixture energy audit",
    }],
    content_calendar: [{
      order: 1,
      title: "Fixture pillar",
      type: "pillar",
      priority: "high",
    }],
  }));

  const result = await generatePillarClusterStrategy({
    main_topic: "home energy audits",
    industry: "residential services",
    target_audience: "Austin homeowners",
    num_cluster_pages: 1,
  });

  assert.equal(result.pillar_page.title, "Fixture pillar");
  assert.equal(result.cluster_pages.length, 1);
  assert.equal(result.content_calendar[0]?.type, "pillar");
  assert.deepEqual(openAiContexts, ["Pillar Cluster Strategy: home energy audits"]);
  assert.equal(openAiRequests.length, 1);
  assert.equal(openAiRequests[0].model, "gpt-4.1-mini");
  assert.equal(openAiRequests[0].response_format.type, "json_object");
  assert.match(openAiRequests[0].messages[0].content, /home energy audits/);
});

test("SEO pillar-cluster planning rejects malformed and empty provider JSON", async () => {
  const { generatePillarClusterStrategy } = await import("../lib/seo-intelligence.js");
  const input = {
    main_topic: "fixture audits",
    industry: "fixture services",
    target_audience: "fixture homeowners",
  };

  openAiResponses.push("not-json");
  await assert.rejects(
    generatePillarClusterStrategy(input),
    /JSON|Unexpected token/i,
  );

  openAiResponses.push("");
  await assert.rejects(
    generatePillarClusterStrategy(input),
    /JSON|Unexpected token|unexpected end/i,
  );
  assert.equal(openAiRequests.length, 2);
});
