/**
 * Sandbox acceptance at the production service/provider boundary.
 *
 * This suite deliberately imports the real SEO and social services, validators,
 * and deterministic schema builders. Only provider submission/accounting and
 * learning-context adapters are stubbed. No network, queue, database, email,
 * publishing, or customer workspace is used.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/qa/content-acceptance-services.test.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { Buffer } from "node:buffer";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

process.env.GEMINI_API_KEY ??= "qa-service-gemini";
process.env.OPENAI_API_KEY ??= "qa-service-openai";

const geminiResponses: string[] = [];
const openAiResponses: string[] = [];
const providerCalls: Array<{ provider: string; operation: string }> = [];
const geminiPrompts: string[] = [];
const openAiPrompts: string[] = [];

moduleMock("@google/genai", {
  namedExports: {
    GoogleGenAI: class FixtureGoogleGenAI {
      readonly models = {
        generateContent: async (request: any) => {
          providerCalls.push({ provider: "gemini-sdk", operation: "generateContent" });
          geminiPrompts.push(String(request?.contents?.[0]?.parts?.[0]?.text ?? ""));
          const text = geminiResponses.shift();
          if (text === undefined) throw new Error("No Gemini service fixture configured");
          return {
            text,
            responseId: `fixture-gemini-${providerCalls.length}`,
            usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7, totalTokenCount: 18 },
          };
        },
      };

      constructor(_options: unknown) {}
    },
  },
});

moduleMock("openai", {
  defaultExport: class FixtureOpenAI {
    readonly chat = {
      completions: {
        create: async (request: any) => {
          providerCalls.push({ provider: "openai-sdk", operation: "chat.completions.create" });
          openAiPrompts.push(String(request?.messages?.[0]?.content ?? ""));
          const content = openAiResponses.shift();
          if (content === undefined) throw new Error("No OpenAI service fixture configured");
          return {
            id: `fixture-openai-${providerCalls.length}`,
            model: request?.model ?? "fixture-model",
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 13, completion_tokens: 9, total_tokens: 22 },
          };
        },
      },
    };

    constructor(_options: unknown) {}
  },
});

const geminiAdapterUrl = new URL("../../lib/gemini.ts", import.meta.url).href;
moduleMock(geminiAdapterUrl, {
  namedExports: {
    submitGeminiRequest: async (
      _request: unknown,
      context: { operationType?: string },
      submit: () => Promise<unknown>,
    ) => {
      providerCalls.push({ provider: "gemini-boundary", operation: context.operationType ?? "unknown" });
      return await submit();
    },
  },
});

const openAiClientUrl = new URL("../../lib/openai-client", import.meta.url).href;
moduleMock(openAiClientUrl, {
  namedExports: {
    openaiClient: {},
    callOpenAI: async (
      operation: (client: unknown) => Promise<unknown>,
      context: string,
    ) => {
      providerCalls.push({ provider: "openai-boundary", operation: context });
      const client = {
        chat: {
          completions: {
            create: async (request: unknown) => {
              const sdk = new ((
                await import("openai")
              ) as any).default({ apiKey: "fixture" });
              return await sdk.chat.completions.create(request);
            },
          },
        },
      };
      return await operation(client);
    },
  },
});

const costTelemetryUrl = new URL("../../lib/cost-telemetry.ts", import.meta.url).href;
moduleMock(costTelemetryUrl, {
  namedExports: {
    extractGeminiUsage: () => ({ inputTokens: 11, outputTokens: 7, totalTokens: 18 }),
    isProviderAccountingError: () => false,
    logCostTelemetry: async () => undefined,
    logFailedProviderAttempt: async () => undefined,
  },
});

const receiptUrl = new URL("../../lib/provider-attempt-receipts.ts", import.meta.url).href;
moduleMock(receiptUrl, {
  namedExports: {
    isProviderAttemptTerminalError: () => false,
  },
});

// Social service imports several fact/receipt helpers whose production
// implementations are database-aware. Fact validation is disabled in these
// cases, so the adapter is intentionally inert and the database remains an
// explicit mock boundary.
moduleMock(new URL("../../lib/db.ts", import.meta.url).href, {
  namedExports: { db: {} },
});

const personaUrl = new URL("../../lib/persona-content-integration.ts", import.meta.url).href;
moduleMock(personaUrl, {
  namedExports: {
    getContentOptimizationContext: async () => ({
      combinedSystemPrompt: "",
      combinedUserPrompt: "",
    }),
  },
});

function resetProviderFixtures() {
  geminiResponses.length = 0;
  openAiResponses.length = 0;
  providerCalls.length = 0;
  geminiPrompts.length = 0;
  openAiPrompts.length = 0;
}

const localResearch = {
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
};

const competitorAnalysis = {
  competitor_url: "https://competitor.example",
  strengths: ["Clear service navigation"],
  weaknesses: ["No local FAQ"],
  content_gaps: ["Seasonal audit checklist"],
  suggested_improvements: [{
    area: "FAQ",
    current_state: "Missing local questions",
    recommended_action: "Publish an Austin-specific FAQ",
    priority: "high",
  }],
  unique_angles: ["Comfort-first audit planning"],
  keyword_opportunities: ["Austin home energy checklist"],
};

const structure = {
  title: "Fixture home energy audit guide",
  meta_description: "A concise fixture guide for Austin homeowners.",
  tldr: "Start with a professional audit.",
  headings: [
    { level: "h1", text: "Fixture home energy audit guide" },
    { level: "h2", text: "What an audit measures", summary: "The key measurements." },
  ],
  faq_section: [{ question: "What does an audit include?", answer: "It reviews the home's energy performance." }],
  key_takeaways: ["Inspect first", "Prioritize repairs"],
  definition_boxes: [{ term: "Energy audit", definition: "A review of energy use and loss." }],
  schema_markup: [{ type: "Article", json_ld: "{\"@type\":\"Article\"}" }],
};

const pillar = {
  pillar_page: {
    title: "Fixture energy audits",
    description: "A practical pillar.",
    target_keywords: ["fixture energy audit"],
    estimated_word_count: 2200,
    sections: ["Overview", "Next steps"],
  },
  cluster_pages: [{
    title: "Fixture checklist",
    description: "A practical checklist.",
    target_keywords: ["fixture checklist"],
    estimated_word_count: 900,
    link_to_pillar: "Fixture energy audits",
    subtopics: ["inspection"],
  }],
  internal_linking_map: [{
    from: "Fixture checklist",
    to: "Fixture energy audits",
    anchor_text: "fixture energy audit",
  }],
  content_calendar: [{
    order: 1,
    title: "Fixture energy audits",
    type: "pillar",
    priority: "high",
  }],
};

test("rows 19, 20, 22, 23: real SEO services accept valid provider JSON and preserve request context", async () => {
  resetProviderFixtures();
  geminiResponses.push(JSON.stringify(localResearch), JSON.stringify(structure));
  openAiResponses.push(JSON.stringify(competitorAnalysis), JSON.stringify(pillar));

  const {
    researchLocalSEO,
    analyzeCompetitor,
    optimizeContentStructure,
    generatePillarClusterStrategy,
  } = await import("../../lib/seo-intelligence.js");

  const local = await researchLocalSEO({
    teamId: 1701,
    location: "Austin, TX",
    business_type: "home energy auditor",
    core_topic: "home comfort",
  });
  const competitor = await analyzeCompetitor({
    competitor_url: "https://competitor.example",
    your_business_type: "home energy auditor",
    focus_areas: ["local FAQ"],
  });
  const contentPlan = await optimizeContentStructure({
    teamId: 1701,
    topic: "home energy audits",
    target_audience: "Austin homeowners",
    word_count_target: 1200,
    include_faq: true,
    include_definitions: true,
  });
  const clusterPlan = await generatePillarClusterStrategy({
    main_topic: "home energy audits",
    industry: "residential services",
    target_audience: "Austin homeowners",
    num_cluster_pages: 1,
  });

  assert.equal(local.local_questions[0]?.search_intent, "transactional");
  assert.equal(competitor.suggested_improvements[0]?.priority, "high");
  assert.equal(contentPlan.headings[1]?.level, "h2");
  assert.equal(clusterPlan.cluster_pages.length, 1);
  assert.match(geminiPrompts[0]!, /Location: Austin, TX/);
  assert.match(openAiPrompts[0]!, /competitor\.example/);
  assert.equal(providerCalls.filter((call) => call.provider === "gemini-boundary").length, 2);
  assert.equal(providerCalls.filter((call) => call.provider === "openai-boundary").length, 2);

  // A response is an output contract, not just an in-memory object: serialize
  // and read back the exact bytes that a JSON response/export would carry.
  const bytes = Buffer.from(JSON.stringify({ local, competitor, contentPlan, clusterPlan }));
  const roundTrip = JSON.parse(bytes.toString("utf8"));
  assert.deepEqual(roundTrip.clusterPlan, clusterPlan);
  assert.deepEqual(roundTrip.local, local);
});

test("rows 19, 20, 22, 23: malformed and empty provider output fails closed without fabricated results", async () => {
  const {
    researchLocalSEO,
    analyzeCompetitor,
    optimizeContentStructure,
    generatePillarClusterStrategy,
  } = await import("../../lib/seo-intelligence.js");

  resetProviderFixtures();
  geminiResponses.push("not-json");
  await assert.rejects(
    researchLocalSEO({ teamId: 1701, location: "Austin, TX", business_type: "auditor" }),
    /Invalid JSON response|Unexpected token/i,
  );

  resetProviderFixtures();
  openAiResponses.push("");
  await assert.rejects(
    analyzeCompetitor({ competitor_url: "https://competitor.example", your_business_type: "auditor" }),
    /Unexpected end|JSON/i,
  );

  resetProviderFixtures();
  geminiResponses.push("");
  await assert.rejects(
    optimizeContentStructure({
      teamId: 1701,
      topic: "fixture audits",
      target_audience: "fixture homeowners",
      word_count_target: 1000,
    }),
    /No response text/i,
  );

  resetProviderFixtures();
  openAiResponses.push("not-json");
  await assert.rejects(
    generatePillarClusterStrategy({
      main_topic: "fixture audits",
      industry: "fixture services",
      target_audience: "fixture homeowners",
    }),
    /JSON|Unexpected token/i,
  );
});

test("rows 21 and 40: schema and Brand Intelligence validators reject malformed output and preserve safe round trips", async () => {
  const {
    generateSchemaMarkup,
    validateSchemaMarkupData,
    SchemaMarkupValidationError,
  } = await import("../../lib/seo-intelligence.js");
  const {
    parseSingleStructuredObject,
    retainSourceSupportedClaims,
    criticalProfileIssues,
  } = await import("../../lib/brand-intelligence-validation.js");

  const schema = await generateSchemaMarkup({
    content_type: "FAQPage",
    data: {
      faqs: [
        { question: " ", answer: "discarded" },
        { question: "What is a fixture audit?", answer: "It reviews a home's energy performance." },
      ],
    },
  });
  const schemaBytes = Buffer.from(schema.json_ld, "utf8");
  const schemaRoundTrip = JSON.parse(schemaBytes.toString("utf8"));
  assert.equal(schemaRoundTrip["@type"], "FAQPage");
  assert.equal(schemaRoundTrip.mainEntity.length, 1);
  assert.throws(
    () => validateSchemaMarkupData("FAQPage", { faqs: [{ question: "", answer: "" }] }),
    (error: unknown) =>
      error instanceof SchemaMarkupValidationError &&
      /at least one non-empty/.test(error.message),
  );

  assert.deepEqual(parseSingleStructuredObject('```json\n{"name":"Fixture"}\n```'), { name: "Fixture" });
  assert.throws(
    () => parseSingleStructuredObject('{"name":"Fixture"} trailing'),
    /trailing content/,
  );
  assert.deepEqual(
    retainSourceSupportedClaims(
      ["The fixture source serves Austin homeowners", "Unsupported market leader"],
      "The fixture source serves Austin homeowners with practical guidance.",
    ),
    {
      approved: ["The fixture source serves Austin homeowners"],
      rejected: ["Unsupported market leader"],
    },
  );
  assert.ok(
    criticalProfileIssues({ brandVoice: { toneAdjectives: [] } }, "").
      includes("required business website could not be fetched or analyzed"),
  );
});

test("row 11: real Gemini social service returns a provider-stubbed caption and rejects empty output", async () => {
  const { generateSocialPostWithGemini, EmptyGeminiSocialResponseError } =
    await import("../../lib/gemini-social.js");

  resetProviderFixtures();
  geminiResponses.push("Fixture energy guidance for Austin homeowners. Learn more at https://fixture.example.");
  const result = await generateSocialPostWithGemini({
    prompt: "Share a practical home energy audit tip.",
    platform: "x",
    tone: "professional",
    mood: "informative",
    industry: "consulting",
    characterLimit: 280,
    location: "Austin, TX",
    topic: "home energy audits",
    companyName: "Fixture Services",
    teamId: 1701,
  });
  assert.match(result.caption, /Fixture energy guidance/);
  assert.equal(result.characterCount, result.caption.length);
  assert.ok(providerCalls.some((call) => call.operation === "social_post"));

  resetProviderFixtures();
  geminiResponses.push("");
  await assert.rejects(
    generateSocialPostWithGemini({
      prompt: "Share a practical home energy audit tip.",
      platform: "x",
      tone: "professional",
      mood: "informative",
      industry: "consulting",
      characterLimit: 280,
      teamId: 1701,
    }),
    (error: unknown) =>
      error instanceof EmptyGeminiSocialResponseError &&
      error.code === "MODEL_OUTPUT_INVALID" &&
      error.nonRetryable === true,
  );
});

test("row 11: social enhancement provider output is validated by the production final caption validator", async () => {
  const { enhanceSocialPostWithGPT } = await import("../../lib/openai-social.js");
  const { enforceSocialCaptionWithHashtags } = await import("../../lib/social-validation.js");

  resetProviderFixtures();
  openAiResponses.push(JSON.stringify({
    caption: "Fixture energy guidance for Austin homeowners.",
    hashtags: [
      { tag: "#Austin", mailtoLink: "mailto:qa@example.invalid?subject=Austin" },
      { tag: "#Energy", mailtoLink: "mailto:qa@example.invalid?subject=Energy" },
      { tag: "#Audits", mailtoLink: "mailto:qa@example.invalid?subject=Audits" },
    ],
    emojis: ["💡"],
    hyperlinks: [{ text: "Learn more", url: "https://fixture.example/learn" }],
  }));
  const enhanced = await enhanceSocialPostWithGPT({
    caption: "Fixture energy guidance for Austin homeowners.",
    platform: "x",
    tone: "professional",
    userEmail: "qa@example.invalid",
    location: "Austin, TX",
    topic: "energy audits",
    industry: "consulting",
    landingPageUrl: "https://fixture.example/learn",
    companyName: "Fixture Services",
  });
  const validated = enforceSocialCaptionWithHashtags(
    enhanced.caption,
    enhanced.hashtags,
    "x",
    "Fixture energy guidance for Austin homeowners.",
  );
  assert.equal(validated.valid, true, validated.issues.join("; "));
  assert.ok(validated.characterCountWithHashtags <= 280);
  assert.equal(enhanced.hyperlinks[0]?.url, "https://fixture.example/learn");

  resetProviderFixtures();
  openAiResponses.push("{");
  const fallback = await enhanceSocialPostWithGPT({
    caption: "Fixture fallback caption.",
    platform: "x",
    tone: "professional",
    userEmail: "qa@example.invalid",
  });
  assert.equal(fallback.caption, "Fixture fallback caption.");
  assert.equal(fallback.hashtags.length, 3);
});
