import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fetchModelCatalog } from "../../lib/model-catalog";
import {
  getAllModels,
  getModelResolutionStatus,
  getResolvedModel,
  isResolverReady,
  MODEL_MAX_STALE_MS,
  notifyModelNotFound,
  refreshModelResolution,
  type ModelResolverDependencies,
} from "../../lib/model-resolver";
import { approvedModels } from "../../lib/model-upgrade-registry";
import { modelProvider, type CatalogModel, type LockedModelRate, type ModelTier } from "../../lib/model-policy";

// Capture configured defaults before the resolver's first refresh mutates its selections.
const defaults = getAllModels();
const lockedRate: LockedModelRate = { input: 10, output: 20, unit: 30, version: "offline-fixture-v1" };

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fullCatalog(provider: "gemini" | "openai"): CatalogModel[] {
  const ids = new Set<string>();
  for (const tier of Object.keys(defaults) as ModelTier[]) {
    if (modelProvider(tier) !== provider) continue;
    ids.add(defaults[tier]);
    for (const candidate of approvedModels(tier)) ids.add(candidate.id);
  }
  return [...ids].map(id => provider === "gemini"
    ? { id, methods: [id.startsWith("veo-") ? "predictLongRunning" : "generateContent"] }
    : { id });
}

function dependencies(options: {
  catalog?: (provider: "gemini" | "openai") => Promise<CatalogModel[]>;
  rates?: (tier: ModelTier, ids: string[]) => Promise<Record<string, LockedModelRate>>;
  now?: () => number;
} = {}): ModelResolverDependencies {
  return {
    catalog: async provider => options.catalog ? options.catalog(provider) : fullCatalog(provider),
    rates: options.rates ?? (async (_tier, ids) =>
      Object.fromEntries(ids.map(id => [id, { ...lockedRate }]))),
    now: options.now,
  };
}

test("Gemini catalog uses credential headers, follows page tokens, and preserves operation metadata", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (calls.length === 1) return response({
      models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }],
      nextPageToken: "page-2",
    });
    return response({
      models: [{ name: "gemini-b", supportedGenerationMethods: ["predictLongRunning"] }],
    });
  }) as typeof fetch;

  const models = await fetchModelCatalog("gemini", "offline-gemini-key", fakeFetch);
  assert.deepEqual(models, [
    { id: "gemini-a", methods: ["generateContent"] },
    { id: "gemini-b", methods: ["predictLongRunning"] },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls.at(0)!.url.searchParams.get("pageSize"), "200");
  assert.equal(calls.at(1)!.url.searchParams.get("pageToken"), "page-2");
  for (const call of calls) {
    assert.equal(call.url.searchParams.has("key"), false);
    assert.equal(call.url.searchParams.has("api_key"), false);
    assert.equal(new Headers(call.init?.headers).get("x-goog-api-key"), "offline-gemini-key");
  }
});

test("OpenAI catalog keeps credentials in Authorization headers and rejects has_more partial lists", async () => {
  let requestUrl = "";
  let authHeader: string | null = null;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    authHeader = new Headers(init?.headers).get("authorization");
    return response({ data: [{ id: "gpt-offline-model" }], has_more: true });
  }) as typeof fetch;

  await assert.rejects(fetchModelCatalog("openai", "offline-openai-key", fakeFetch), /incomplete catalog/);
  assert.equal(authHeader, "Bearer offline-openai-key");
  assert.equal(new URL(requestUrl).search, "");
  assert.equal(requestUrl.includes("offline-openai-key"), false);
});

test("repeated Gemini pagination tokens fail closed", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return response({
      models: [{ name: `gemini-page-${calls}`, supportedGenerationMethods: ["generateContent"] }],
      nextPageToken: "repeat",
    });
  }) as typeof fetch;
  await assert.rejects(fetchModelCatalog("gemini", "fixture", fakeFetch), /invalid pagination/);
  assert.equal(calls, 2);
});

test("Gemini pagination is bounded even when a provider keeps issuing new tokens", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls++;
    return response({
      models: [{ name: `gemini-page-${calls}`, supportedGenerationMethods: ["generateContent"] }],
      nextPageToken: `token-${calls}`,
    });
  }) as typeof fetch;
  await assert.rejects(fetchModelCatalog("gemini", "fixture", fakeFetch), /page limit exceeded/);
  assert.equal(calls, 20);
});

test("malformed catalog model IDs and Gemini method metadata fail closed", async () => {
  const malformed = [
    { models: [{ name: "models/bad model", supportedGenerationMethods: ["generateContent"] }] },
    { models: [{ name: "gemini-no-methods" }] },
    { models: [{ name: "gemini-bad-method", supportedGenerationMethods: ["generateContent", 7] }] },
  ];
  for (const body of malformed) {
    const fakeFetch = (async () => response(body)) as typeof fetch;
    await assert.rejects(fetchModelCatalog("gemini", "fixture", fakeFetch), /malformed/);
  }
  const malformedOpenAI = (async () => response({ data: [{ id: "has spaces" }], has_more: false })) as typeof fetch;
  await assert.rejects(fetchModelCatalog("openai", "fixture", malformedOpenAI), /malformed model ID/);
});

test("startup with empty catalogs is not ready and reports unavailable critical tiers", async () => {
  await refreshModelResolution(true, dependencies({ catalog: async () => [] }));
  assert.equal(isResolverReady(), false);
  const status = getModelResolutionStatus();
  const gemini = status.providers.gemini;
  const openai = status.providers.openai;
  assert.ok(gemini);
  assert.ok(openai);
  assert.equal(status.initialized, true);
  assert.equal(status.ready, false);
  assert.equal(gemini.available, false);
  assert.equal(openai.available, false);
  assert.equal(gemini.modelCount, 0);
  const critical = status.tiers.filter(tier =>
    ["geminiFlash", "geminiArticle", "geminiPro", "gptMini", "gptAdvanced"].includes(tier.tier));
  assert.ok(critical.every(tier => tier.selected === null && tier.usable === false && tier.reason === "unavailable"));
  assert.ok(critical.every(tier => tier.blocked?.some(item => /catalog unavailable/.test(item.reason)) === true));
});

test("known equal-cost catalog approval promotes Gemini critique to the newer approved model", async () => {
  const now = Date.now();
  await refreshModelResolution(true, dependencies({ now: () => now }));
  const status = getModelResolutionStatus();
  const critique = status.tiers.find(tier => tier.tier === "geminiCritique")!;
  assert.equal(defaults.geminiCritique, "gemini-2.5-flash-lite");
  assert.equal(critique.selected, "gemini-3.5-flash-lite");
  assert.equal(critique.reason, "automatic");
  assert.equal(isResolverReady(), true);
});

test("pricing outage preserves the configured baseline and reports blocked promotion evidence", async () => {
  await refreshModelResolution(true, dependencies({
    rates: async () => { throw new Error("fixture pricing source unavailable"); },
  }));
  const critique = getModelResolutionStatus().tiers.find(tier => tier.tier === "geminiCritique")!;
  assert.equal(critique.selected, defaults.geminiCritique);
  assert.equal(critique.reason, "fallback");
  assert.ok(critique.blocked?.some(item => /pricing/.test(item.reason)));
});

test("concurrent forced refreshes coalesce into one provider and pricing refresh", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const calls = { gemini: 0, openai: 0, rates: 0 };
  const deps = dependencies({
    catalog: async provider => {
      calls[provider]++;
      if (calls.gemini + calls.openai === 1) {
        started();
        await gate;
      }
      return fullCatalog(provider);
    },
    rates: async (_tier, ids) => {
      calls.rates++;
      return Object.fromEntries(ids.map(id => [id, { ...lockedRate }]));
    },
  });
  const first = refreshModelResolution(true, deps);
  const second = refreshModelResolution(true, deps);
  assert.strictEqual(second, first);
  await entered;
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls.gemini, 1);
  assert.deepEqual(calls.openai, 1);
  assert.ok(calls.rates > 0);
});

test("resolved-model lookup after an injected fresh refresh does not refresh again", async () => {
  const calls = { gemini: 0, openai: 0 };
  await refreshModelResolution(true, dependencies({
    catalog: async provider => {
      calls[provider]++;
      return fullCatalog(provider);
    },
  }));
  const countsAfterForce = { ...calls };
  assert.equal(await getResolvedModel("geminiCritique"), "gemini-3.5-flash-lite");
  assert.deepEqual(calls, countsAfterForce);
});

test("within-TTL price increases revalidate a promotion and fall back to the configured model", async () => {
  let promotionPriceIncreased = false;
  const calls = { gemini: 0, openai: 0, rates: 0 };
  const deps = dependencies({
    catalog: async provider => {
      calls[provider]++;
      return fullCatalog(provider);
    },
    rates: async (tier, ids) => {
      calls.rates++;
      return Object.fromEntries(ids.map(id => [
        id,
        {
          ...lockedRate,
          ...(promotionPriceIncreased && tier === "geminiCritique" && id !== defaults.geminiCritique
            ? { input: lockedRate.input + 1 }
            : {}),
        },
      ]));
    },
  });

  await refreshModelResolution(true, deps);
  assert.equal(await getResolvedModel("geminiCritique"), "gemini-3.5-flash-lite");
  const catalogCallsAtPromotion = { gemini: calls.gemini, openai: calls.openai };
  const rateCallsAtPromotion = calls.rates;

  promotionPriceIncreased = true;
  assert.equal(await getResolvedModel("geminiCritique"), defaults.geminiCritique);
  assert.deepEqual({ gemini: calls.gemini, openai: calls.openai }, catalogCallsAtPromotion);
  assert.equal(calls.rates, rateCallsAtPromotion + 1);
});

test("catalog outage uses bounded last-good selections but makes readiness false", async () => {
  const now = Date.now();
  await refreshModelResolution(true, dependencies({ now: () => now }));
  const lastGood = new Map(getModelResolutionStatus().tiers.map(tier => [tier.tier, tier.selected]));
  await refreshModelResolution(true, dependencies({
    now: () => now + 1_000,
    catalog: async () => { throw new Error("offline catalog fixture"); },
  }));
  const status = getModelResolutionStatus();
  const gemini = status.providers.gemini;
  const openai = status.providers.openai;
  assert.ok(gemini);
  assert.ok(openai);
  assert.equal(status.ready, false);
  assert.equal(gemini.available, false);
  assert.equal(openai.available, false);
  assert.ok(gemini.error?.includes("no new promotions"));
  assert.ok(status.tiers.every(tier => tier.selected === lastGood.get(tier.tier)));
});

test("expired last-good catalog selections become unusable", async () => {
  const now = Date.now();
  await refreshModelResolution(true, dependencies({ now: () => now }));
  await refreshModelResolution(true, dependencies({
    now: () => now + MODEL_MAX_STALE_MS + 1,
    catalog: async () => { throw new Error("expired offline catalog fixture"); },
  }));
  const status = getModelResolutionStatus();
  assert.equal(status.ready, false);
  assert.ok(status.tiers.every(tier => tier.selected === null && tier.usable === false));
  await assert.rejects(getResolvedModel("geminiCritique"), /No validated model available/);
});

test("admin model diagnostics authenticates before refresh and exposes no POST generation path", () => {
  const route = readFileSync("app/api/admin/models/route.ts", "utf8");
  assert.match(route, /export async function GET\(request: NextRequest\)/);
  assert.match(route, /await requireAdmin\(request\);\s*await refreshModelResolution\(\);/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /generateContent|chat\.completions|models\.generateContent/);
});

test("model-not-found notification quarantines the rejected ID and refreshes to a priced fallback without replay", async () => {
  assert.equal(defaults.gptAdvanced, "gpt-4.1");
  await refreshModelResolution(true, dependencies());
  assert.equal(getModelResolutionStatus().tiers.find(tier => tier.tier === "gptAdvanced")!.selected, "gpt-4.1");

  notifyModelNotFound("gpt-4.1");
  assert.equal(
    getModelResolutionStatus().tiers.find(tier => tier.tier === "gptAdvanced")!.selected,
    null,
  );

  const calls = { gemini: 0, openai: 0, rates: 0 };
  const pricedTiers = new Set<ModelTier>();
  await refreshModelResolution(true, dependencies({
    catalog: async provider => {
      calls[provider]++;
      return fullCatalog(provider);
    },
    rates: async (tier, ids) => {
      calls.rates++;
      pricedTiers.add(tier);
      return Object.fromEntries(ids.map(id => [id, { ...lockedRate }]));
    },
  }));
  const advanced = getModelResolutionStatus().tiers.find(tier => tier.tier === "gptAdvanced")!;
  assert.ok(pricedTiers.has("gptAdvanced"), "quarantining a still-listed configured ID must request fallback pricing");
  assert.equal(advanced.selected, "gpt-4.1-2025-04-14");
  assert.equal(advanced.reason, "automatic");
  assert.deepEqual(calls.gemini, 1);
  assert.deepEqual(calls.openai, 1);
  assert.ok(calls.rates > 0);
  assert.equal(getAllModels().gptAdvanced, "gpt-4.1-2025-04-14");
});

