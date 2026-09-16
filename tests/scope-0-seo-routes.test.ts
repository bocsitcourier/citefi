/**
 * Scope 0 route-boundary locks for the four SEO tools that use provider-backed
 * services. The auth and service modules are mocked at their module boundary;
 * the actual Next route handlers, request parsing, status codes, and response
 * serialization execute in-process.
 *
 * Run:
 *   node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/scope-0-seo-routes.test.ts
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { NextRequest } from "next/server";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

process.env.GEMINI_API_KEY ||= "scope0-gemini-fixture";
process.env.OPENAI_API_KEY ||= "scope0-openai-fixture";

type AuthMode = "allow" | "deny";
let authMode: AuthMode = "allow";
let authCalls = 0;
let schemaValidationMode: "allow" | "throw" = "allow";
let schemaValidationCalls = 0;
const serviceCalls = {
  local: 0,
  schema: 0,
  structure: 0,
  pillar: 0,
};
const serviceInputs = {
  local: [],
  schema: [],
  structure: [],
  pillar: [],
} as Record<keyof typeof serviceCalls, any[]>;
class FixtureSchemaMarkupValidationError extends Error {}

const authUrl = new URL("../lib/api/auth.ts", import.meta.url).href;
moduleMock(authUrl, {
  namedExports: {
    withAuthenticatedTeamContext: async (
      _request: NextRequest,
      callback: (auth: { userId: number; teamId: number; role: string }) => unknown,
    ) => {
      authCalls++;
      if (authMode === "deny") {
        return Response.json({ error: "Access denied" }, { status: 401 });
      }
      return await callback({ userId: 701, teamId: 702, role: "team_member" });
    },
  },
});

const seoUrl = new URL("../lib/seo-intelligence.ts", import.meta.url).href;
moduleMock(seoUrl, {
  namedExports: {
    researchLocalSEO: async (input: unknown) => {
      serviceCalls.local++;
      serviceInputs.local.push(input);
      return {
        location: "Austin, TX",
        business_type: "fixture auditor",
        location_keywords: {
          primary: ["Austin fixture auditor"],
          long_tail: [],
          neighborhood_specific: [],
          landmarks: [],
        },
        seasonal_trends: [],
        local_questions: [],
        local_slang: [],
        cultural_references: [],
        trending_topics: [],
      };
    },
    validateSchemaMarkupData: (_type: string, data: unknown) => {
      schemaValidationCalls++;
      if (schemaValidationMode === "throw") {
        throw new FixtureSchemaMarkupValidationError("Fixture schema is invalid");
      }
      return data;
    },
    generateSchemaMarkup: async (input: unknown) => {
      serviceCalls.schema++;
      serviceInputs.schema.push(input);
      return {
        type: "FAQPage",
        json_ld: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [],
        }),
      };
    },
    SchemaMarkupValidationError: FixtureSchemaMarkupValidationError,
    optimizeContentStructure: async (input: unknown) => {
      serviceCalls.structure++;
      serviceInputs.structure.push(input);
      return {
        title: "Fixture structure",
        meta_description: "Fixture description",
        tldr: "Fixture summary",
        headings: [],
        faq_section: [],
        key_takeaways: ["Fixture takeaway"],
        definition_boxes: [],
        schema_markup: [],
      };
    },
    generatePillarClusterStrategy: async (input: unknown) => {
      serviceCalls.pillar++;
      serviceInputs.pillar.push(input);
      return {
        pillar_page: {
          title: "Fixture pillar",
          description: "Fixture description",
          target_keywords: ["fixture"],
          estimated_word_count: 2000,
          sections: ["Fixture section"],
        },
        cluster_pages: [],
        internal_linking_map: [],
        content_calendar: [],
      };
    },
  },
});

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/scope0", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jsonResponse(response: Response): Promise<any> {
  return await response.json();
}

function resetCalls() {
  authCalls = 0;
  schemaValidationMode = "allow";
  schemaValidationCalls = 0;
  for (const key of Object.keys(serviceCalls) as (keyof typeof serviceCalls)[]) {
    serviceCalls[key] = 0;
    serviceInputs[key].length = 0;
  }
}

const routes = [
  {
    name: "local research",
    path: "../app/api/seo/local-research/route.js",
    service: "local" as const,
    valid: { location: "Austin, TX", business_type: "fixture auditor", core_topic: "comfort" },
    missing: { location: "Austin, TX" },
    expectedKey: "location",
    canonicalInput: {
      teamId: 702,
      location: "Austin, TX",
      business_type: "fixture auditor",
      core_topic: "comfort",
    },
  },
  {
    name: "schema markup",
    path: "../app/api/seo/schema-markup/route.js",
    service: "schema" as const,
    valid: { content_type: "FAQPage", data: { faqs: [{ question: "Q", answer: "A" }] } },
    missing: { content_type: "FAQPage" },
    expectedKey: "type",
    canonicalInput: {
      content_type: "FAQPage",
      data: { faqs: [{ question: "Q", answer: "A" }] },
    },
  },
  {
    name: "content structure",
    path: "../app/api/seo/content-structure/route.js",
    service: "structure" as const,
    valid: { topic: "fixture audits", target_audience: "fixture homeowners" },
    missing: { topic: "fixture audits" },
    expectedKey: "title",
    canonicalInput: {
      teamId: 702,
      topic: "fixture audits",
      target_audience: "fixture homeowners",
      word_count_target: 1500,
      include_faq: true,
      include_definitions: true,
    },
  },
  {
    name: "pillar cluster",
    path: "../app/api/seo/pillar-cluster/route.js",
    service: "pillar" as const,
    valid: {
      main_topic: "fixture audits",
      industry: "fixture services",
      target_audience: "fixture homeowners",
      num_cluster_pages: 1,
    },
    missing: { main_topic: "fixture audits", industry: "fixture services" },
    expectedKey: "pillar_page",
    canonicalInput: {
      main_topic: "fixture audits",
      industry: "fixture services",
      target_audience: "fixture homeowners",
      num_cluster_pages: 1,
    },
  },
] as const;

for (const route of routes) {
  test(`${route.name} route runs authenticated success through its service boundary`, async () => {
    resetCalls();
    authMode = "allow";
    const mod: any = await import(route.path);
    const response = await mod.POST(request(route.valid));
    assert.equal(response.status, 200);
    assert.ok((await jsonResponse(response))[route.expectedKey]);
    assert.equal(authCalls, 1);
    assert.equal(serviceCalls[route.service], 1);
    assert.deepEqual(serviceInputs[route.service][0], route.canonicalInput);
    if (route.service === "local" || route.service === "structure") {
      assert.equal(serviceInputs[route.service][0]!.teamId, 702);
    }
    if (route.service === "schema") {
      assert.equal(serviceInputs.schema[0]!.content_type, "FAQPage");
    }
    if (route.service === "pillar") {
      assert.equal(serviceInputs.pillar[0]!.main_topic, "fixture audits");
    }
  });

  test(`${route.name} route returns 400 for required input before downstream service`, async () => {
    resetCalls();
    authMode = "allow";
    const mod: any = await import(route.path);
    const response = await mod.POST(request(route.missing));
    assert.equal(response.status, 400);
    assert.match((await jsonResponse(response)).error, /required/i);
    assert.equal(authCalls, 1);
    assert.equal(serviceCalls[route.service], 0);
  });

  test(`${route.name} route returns auth denial without downstream service`, async () => {
    resetCalls();
    authMode = "deny";
    const mod: any = await import(route.path);
    const response = await mod.POST(request(route.valid));
    assert.equal(response.status, 401);
    assert.equal(authCalls, 1);
    assert.equal(serviceCalls[route.service], 0);
  });
}

test("schema markup route rejects an unsupported type before validation or generation", async () => {
  resetCalls();
  authMode = "allow";
  const { POST } = await import("../app/api/seo/schema-markup/route.js");
  const response = await POST(request({ content_type: "Unsupported", data: { fixture: true } }));

  assert.equal(response.status, 400);
  assert.match((await jsonResponse(response)).error, /Invalid content_type/);
  assert.equal(schemaValidationCalls, 0);
  assert.equal(serviceCalls.schema, 0);
});

test("schema markup route maps SchemaMarkupValidationError to 400 before generation", async () => {
  resetCalls();
  authMode = "allow";
  schemaValidationMode = "throw";
  const { POST } = await import("../app/api/seo/schema-markup/route.js");
  const response = await POST(request({
    content_type: "FAQPage",
    data: { faqs: [{ question: "Fixture question", answer: "Fixture answer" }] },
  }));

  assert.equal(response.status, 400);
  assert.equal((await jsonResponse(response)).error, "Fixture schema is invalid");
  assert.equal(schemaValidationCalls, 1);
  assert.equal(serviceCalls.schema, 0);
});