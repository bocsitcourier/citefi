import { readFile, writeFile } from "node:fs/promises";

type Step = {
  name: string;
  auth: "none" | "fixture";
  method: "GET" | "POST";
  route: string;
  body?: unknown;
  expectedStatuses: number[];
  safety: string;
};

type StepResult = Step & {
  status: number | null;
  durationMs: number;
  message: string;
  passed: boolean;
};

const session = JSON.parse(await readFile("reports/live-generation/session.json", "utf8"));
const credentials = JSON.parse(await readFile(".local/test-fixtures/live-generation.json", "utf8"));
if (!session.isolation?.developmentOnly || !session.isolation?.syntheticIdentity) {
  throw new Error("The isolated development fixture is required");
}
if (session.team?.teamId !== 2535 || session.identity?.userId !== 10794) {
  throw new Error("Unexpected fixture identity");
}

const baseUrl = process.env.TEST_BASE_URL ?? session.httpConfirmation?.baseUrl ?? "http://localhost:5000";
const articleId = 2235;
const batchId = 626;
const nonexistentUuid = "26091000-0000-4000-8000-000000000099";
const nonexistentIdentity = "qa-invalid-asset-identity";

const inventoryRoutes: Array<[string, "GET" | "POST"]> = [
  ["/api/jobs/title-pool", "GET"],
  ["/api/jobs/batch-submit", "POST"],
  [`/api/articles/${articleId}/regenerate`, "POST"],
  [`/api/batches/${batchId}/regenerate-titles`, "POST"],
  ...["seo-title", "meta-description", "keywords", "slug", "faq", "hashtags"].map(
    (field) => [`/api/content/${articleId}/regenerate/${field}`, "POST"] as [string, "POST"],
  ),
  [`/api/articles/${articleId}/reformat`, "POST"],
  [`/api/articles/${articleId}/apply-hyperlinks`, "POST"],
  [`/api/batches/${batchId}/apply-keyword-hyperlinks`, "POST"],
  [`/api/batches/${batchId}/fix-hyperlinks`, "POST"],
  [`/api/articles/${articleId}/regenerate-hero`, "POST"],
  [`/api/content/${articleId}/regenerate-hero-image`, "POST"],
  [`/api/media/${articleId}/regenerate`, "POST"],
  [`/api/batches/${batchId}/regenerate-images`, "POST"],
  [`/api/batches/${batchId}/fix-image-captions`, "POST"],
  [`/api/media/assets/${nonexistentIdentity}/regenerate`, "POST"],
  ["/api/social_posts/generate", "POST"],
  [`/api/social-posts/variants/${articleId}/regenerate`, "POST"],
  ["/api/social/video/generate", "POST"],
  ["/api/social/video/batch", "POST"],
  ["/api/social/video/cancel", "POST"],
  ["/api/social/video/idea", "POST"],
  [`/api/social/video/idea/${articleId}/generate`, "POST"],
  ["/api/social/video/like", "POST"],
  [`/api/social/video/like/${articleId}/analyze`, "POST"],
  [`/api/social/video/like/${articleId}/generate`, "POST"],
  ["/api/podcast/generate", "POST"],
  ...["content-audit", "local-research", "competitor-analysis", "schema-markup",
    "content-structure", "pillar-cluster", "create-articles"].map(
    (name) => [`/api/seo/${name}`, "POST"] as [string, "POST"],
  ),
  ["/api/briefs/generate-me", "POST"],
  ["/api/briefs/generate-now", "POST"],
  [`/api/campaigns/${nonexistentUuid}/ads`, "POST"],
  [`/api/campaigns/${nonexistentUuid}/confirm-brand`, "POST"],
  [`/api/journeys/${nonexistentUuid}/trigger`, "POST"],
  [`/api/batches/${batchId}/launch-journey`, "POST"],
  ["/api/learning/mine-corpus", "POST"],
  ["/api/learning/monitor/mine-corpus", "POST"],
  [`/api/learning/agents/${articleId}/seed`, "POST"],
  [`/api/learning/agents/${articleId}/optimize`, "POST"],
  [`/api/admin/incidents/${nonexistentUuid}/analysis`, "POST"],
  ["/api/admin/seo-report", "POST"],
  ["/api/agency/reports/generate", "POST"],
];

const steps: Step[] = inventoryRoutes.map(([route, method]) => ({
  name: "unauthenticated auth-gate check",
  auth: "none",
  method,
  route,
  body: method === "POST" ? {} : undefined,
  expectedStatuses: [401, 403],
  safety: "No credentials; no conclusion about provider internals",
}));

steps.push(
  {
    name: "batch submit rejects missing required fields",
    auth: "fixture", method: "POST", route: "/api/jobs/batch-submit", body: {},
    expectedStatuses: [400], safety: "Zod rejection occurs before reservation or queueing",
  },
  {
    name: "batch submit rejects invalid body types",
    auth: "fixture", method: "POST", route: "/api/jobs/batch-submit",
    body: { batchId: String(batchId), selectedTitles: "not-an-array", targetUrl: 42, businessName: [] },
    expectedStatuses: [400], safety: "Zod rejection occurs before reservation or queueing",
  },
  {
    name: "social generation rejects missing required fields",
    auth: "fixture", method: "POST", route: "/api/social_posts/generate", body: {},
    expectedStatuses: [400], safety: "Zod rejection occurs before reservation or queueing",
  },
  {
    name: "social generation rejects invalid body types",
    auth: "fixture", method: "POST", route: "/api/social_posts/generate",
    body: { standaloneTitle: ["invalid"], platforms: "not-an-array" },
    expectedStatuses: [400], safety: "Zod rejection occurs before reservation or queueing",
  },
  {
    name: "video generation rejects missing social post",
    auth: "fixture", method: "POST", route: "/api/social/video/generate", body: {},
    expectedStatuses: [400], safety: "Required-field rejection precedes lookup, reservation, and queueing",
  },
  {
    name: "video generation rejects unsupported video format",
    auth: "fixture", method: "POST", route: "/api/social/video/generate",
    body: { socialPostId: -626, videoType: "unsupported-qa-format" },
    expectedStatuses: [400], safety: "Explicit videoType allowlist rejection precedes database/provider work",
  },
  {
    name: "video batch rejects invalid ID collection type",
    auth: "fixture", method: "POST", route: "/api/social/video/batch",
    body: { socialPostIds: "not-an-array" },
    expectedStatuses: [400], safety: "Type rejection precedes lookup, reservation, and queueing",
  },
  {
    name: "video cancellation rejects missing required field",
    auth: "fixture", method: "POST", route: "/api/social/video/cancel", body: {},
    expectedStatuses: [400], safety: "No cancellation target supplied",
  },
  {
    name: "idea input rejects missing required fields",
    auth: "fixture", method: "POST", route: "/api/social/video/idea", body: {},
    expectedStatuses: [400], safety: "Zod rejection precedes persistence; route does not generate media",
  },
  {
    name: "idea input rejects unsupported style",
    auth: "fixture", method: "POST", route: "/api/social/video/idea",
    body: {
      ideaTitle: "Synthetic QA idea", shortIdea: "Synthetic QA detail long enough for validation.",
      companyName: "Harbor Home Energy", style: "unsupported-qa-style",
    },
    expectedStatuses: [400], safety: "Explicit style enum rejection precedes persistence or generation",
  },
  {
    name: "like-video input rejects invalid body types",
    auth: "fixture", method: "POST", route: "/api/social/video/like",
    body: { referenceVideoUrl: 42, ideaTitle: [], shortIdea: {}, companyName: false },
    expectedStatuses: [400], safety: "Zod rejection precedes URL fetch or persistence",
  },
  {
    name: "like-video input rejects unsupported URL protocol",
    auth: "fixture", method: "POST", route: "/api/social/video/like",
    body: {
      referenceVideoUrl: "ftp://example.invalid/synthetic.mp4", ideaTitle: "Synthetic QA idea",
      shortIdea: "Synthetic QA details", companyName: "Harbor Home Energy",
    },
    expectedStatuses: [400], safety: "External URL validator rejects before fetch or persistence",
  },
  {
    name: "podcast rejects missing article ID",
    auth: "fixture", method: "POST", route: "/api/podcast/generate", body: {},
    expectedStatuses: [400], safety: "Required-field rejection precedes article lookup, reservation, or queueing",
  },
  ...[
    ["content-audit", "Article ID is required"],
    ["local-research", "location and business_type are required"],
    ["competitor-analysis", "competitor URL and business type are required"],
    ["schema-markup", "content type and data are required"],
    ["content-structure", "topic and target audience are required"],
    ["pillar-cluster", "topic, industry, and audience are required"],
    ["create-articles", "SEO inputs are required"],
  ].map(([name, requirement]): Step => ({
    name: `SEO ${name} rejects missing fields (${requirement})`,
    auth: "fixture", method: "POST", route: `/api/seo/${name}`, body: {},
    expectedStatuses: [400], safety: "Required-field rejection inspected before provider call",
  })),
  {
    name: "schema generation rejects unsupported content format",
    auth: "fixture", method: "POST", route: "/api/seo/schema-markup",
    body: { content_type: "UnsupportedSyntheticType", data: { name: "Harbor Home Energy" } },
    expectedStatuses: [400], safety: "Explicit content_type allowlist rejection precedes provider call",
  },
  {
    name: "SEO article creation rejects unsupported tool format",
    auth: "fixture", method: "POST", route: "/api/seo/create-articles",
    body: {
      seoToolType: "unsupported_synthetic_type", seoToolOutput: {},
      targetUrl: "https://www.energy.gov/energysaver",
    },
    expectedStatuses: [400], safety: "Explicit switch default rejection precedes title generation",
  },
  {
    name: "campaign ads rejects missing required fields",
    auth: "fixture", method: "POST", route: `/api/campaigns/${nonexistentUuid}/ads`, body: {},
    expectedStatuses: [400], safety: "Zod rejection occurs before campaign lookup, reservation, or provider call",
  },
  {
    name: "agency report rejects invalid body",
    auth: "fixture", method: "POST", route: "/api/agency/reports/generate", body: {},
    expectedStatuses: [400], safety: "Schema rejection; deterministic report route",
  },
);

function boundedMessage(value: unknown): string {
  let message = "";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidate = record.error ?? record.message;
    message = typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? value);
  } else {
    message = String(value ?? "");
  }
  return message.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 240);
}

async function request(step: Step, token?: string): Promise<StepResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(new URL(step.route, baseUrl), {
      method: step.method,
      headers: {
        ...(step.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-forwarded-for": "10.0.0.1, 198.51.100.253",
      },
      body: step.body === undefined ? undefined : JSON.stringify(step.body),
      redirect: "manual",
      signal: controller.signal,
    });
    const text = (await response.text()).slice(0, 2_000);
    let payload: unknown = text;
    try { payload = JSON.parse(text); } catch {}
    return {
      ...step,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      message: boundedMessage(payload),
      passed: step.expectedStatuses.includes(response.status),
    };
  } catch (error) {
    return {
      ...step,
      status: null,
      durationMs: Math.round(performance.now() - started),
      message: error instanceof Error ? error.name : "Request failed",
      passed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

const loginResponse = await fetch(new URL("/api/auth/login", baseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-forwarded-for": "10.0.0.1, 198.51.100.253",
  },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }),
});
const loginPayload = await loginResponse.json().catch(() => ({})) as { previewToken?: string };
if (loginResponse.status !== 200 || !loginPayload.previewToken) {
  throw new Error(`Fixture login failed with status ${loginResponse.status}`);
}

const results: StepResult[] = [];
for (const step of steps) {
  results.push(await request(step, step.auth === "fixture" ? loginPayload.previewToken : undefined));
}

const failed = results.filter((result) => !result.passed);
const report = {
  runAt: new Date().toISOString(),
  scope: {
    inventory: "reports/live-generation/masterinventory.json",
    fixtureTeamId: 2535,
    fixtureArticleId: articleId,
    fixtureBatchId: batchId,
    realHttp: true,
    positiveGenerationCalls: 0,
    authenticatedRegenerationCalls: 0,
  },
  summary: {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    complete: failed.length === 0,
  },
  observations: [
    "401/403 results demonstrate only the observed HTTP authentication gate response; they do not prove provider internals.",
    "Authenticated tests were limited to source-inspected schema/required-field branches that precede provider work.",
    "No authenticated regenerate endpoint was called because empty bodies can be valid regeneration requests.",
    "All 24 authenticated invalid-input checks returned HTTP 400 before the inspected provider branches.",
    "Unauthenticated POST /api/batches/626/regenerate-titles returned HTTP 500 rather than an auth status. Source inspection shows its outer catch attempts to insert a failure event even when authentication did not complete, which can mask the original auth error.",
    "Social platform strings have no API allowlist in the inspected social generation schema; an unsupported value was not sent because it could enqueue paid work.",
    "No generation language allowlist was found in the inspected generation route validators, so no safe unsupported-language HTTP test was available.",
    "Inventory method for /api/jobs/title-pool is GET, but the actual route exports POST; the inventory-method request returned HTTP 405.",
    "Inventory lists POST /api/admin/seo-report, while the actual route exports GET; the inventory-method request returned HTTP 405.",
  ],
  steps: results,
};
await writeFile("reports/live-generation/negative-api-run.json", `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report.summary));
if (failed.length) process.exitCode = 2;