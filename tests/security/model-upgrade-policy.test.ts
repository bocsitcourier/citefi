import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_CONTRACTS,
  selectTierModel,
  type ApprovedModel,
  type CatalogModel,
  type LockedModelRate,
  type ModelDecision,
  type ModelTier,
} from "../../lib/model-policy";
import { approvedModels } from "../../lib/model-upgrade-registry";

const baseline = "gpt-mini-current";
const baselineRate: LockedModelRate = { input: 10, output: 20, unit: 30, version: "locked-v1" };
const equalRate: LockedModelRate = { input: 10, output: 20, unit: 30, version: "locked-v2" };

function model(id: string, contract = MODEL_CONTRACTS.gptMini, priority = 1): ApprovedModel {
  return { id, priority, contract };
}

function decide(options: {
  tier?: ModelTier;
  configured?: string;
  pinned?: boolean;
  catalog?: CatalogModel[];
  approved?: ApprovedModel[];
  rates?: Record<string, LockedModelRate>;
} = {}) {
  return selectTierModel({
    tier: options.tier ?? "gptMini",
    configured: options.configured ?? baseline,
    pinned: options.pinned ?? false,
    catalog: options.catalog ?? [{ id: baseline }, { id: "gpt-mini-upgrade" }],
    approved: options.approved ?? [model(baseline), model("gpt-mini-upgrade", undefined, 2)],
    rates: options.rates ?? { [baseline]: baselineRate, "gpt-mini-upgrade": equalRate },
  });
}

function firstBlocked(decision: ModelDecision) {
  assert.ok(decision.blocked.length > 0, "expected at least one blocked model");
  return decision.blocked[0]!;
}

test("new approved compatible candidate automatically replaces a still-listed current model", () => {
  const result = decide();
  assert.deepEqual(result, {
    tier: "gptMini",
    selected: "gpt-mini-upgrade",
    reason: "automatic",
    blocked: [],
  });
});

test("unknown or unapproved catalog models are never selected, regardless of apparent recency", () => {
  const result = decide({
    catalog: [{ id: baseline }, { id: "gpt-mini-current-9999-newest" }],
    approved: [model(baseline)],
    rates: { [baseline]: baselineRate },
  });
  assert.equal(result.selected, baseline);
  assert.equal(result.reason, "fallback");
});

test("candidate eligibility follows explicit approval priority, not model version-looking names", () => {
  const result = decide({
    catalog: [{ id: baseline }, { id: "model-v99" }, { id: "model-v2" }],
    approved: [model(baseline, undefined, 0), model("model-v99", undefined, 1), model("model-v2", undefined, 9)],
    rates: { [baseline]: baselineRate, "model-v99": equalRate, "model-v2": equalRate },
  });
  assert.equal(result.selected, "model-v2");
});

test("registry exposes only release-controlled candidates with explicit tier contracts and priorities", () => {
  const choices = approvedModels("gptMini");
  assert.deepEqual(choices.map(({ id, priority }) => ({ id, priority })), [
    { id: "gpt-4.1-mini", priority: 3 },
    { id: "gpt-4.1-mini-2025-04-14", priority: 2 },
    { id: "gpt-4o-mini", priority: 1 },
  ]);
  assert.ok(choices.every(candidate => candidate.contract === MODEL_CONTRACTS.gptMini));
  assert.deepEqual(approvedModels("geminiImage").map(candidate => candidate.contract), [
    "gemini-image", "gemini-image",
  ]);
});

test("missing locked price evidence blocks promotions and an unpriced baseline", () => {
  const missingCandidate = decide({
    rates: { [baseline]: baselineRate },
  });
  assert.equal(missingCandidate.selected, baseline);
  assert.match(missingCandidate.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /pricing/);

  const missingBaseline = decide({
    rates: { "gpt-mini-upgrade": equalRate },
  });
  assert.equal(missingBaseline.selected, baseline);
  assert.equal(missingBaseline.reason, "fallback");
  assert.match(missingBaseline.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /pricing/);
});

test("zero-total, NaN, negative, and unsafe-integer rates are rejected", () => {
  const malformedRates: Array<[string, LockedModelRate]> = [
    ["all zero", { input: 0, output: 0, unit: 0, version: "zero" }],
    ["NaN", { input: Number.NaN, output: 20, unit: 30, version: "nan" }],
    ["negative", { input: 10, output: -1, unit: 30, version: "negative" }],
    ["unsafe", { input: Number.MAX_SAFE_INTEGER + 1, output: 20, unit: 30, version: "unsafe" }],
  ];
  for (const [label, invalidRate] of malformedRates) {
    const result = decide({
      rates: { [baseline]: baselineRate, "gpt-mini-upgrade": invalidRate },
    });
    assert.equal(result.selected, baseline, label);
    assert.match(result.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /pricing/, label);
  }
  const zeroRate = malformedRates.find(([label]) => label === "all zero")?.[1];
  assert.ok(zeroRate);
  const invalidBaseline = decide({ rates: { [baseline]: zeroRate, "gpt-mini-upgrade": equalRate } });
  assert.equal(invalidBaseline.selected, baseline);
  assert.match(invalidBaseline.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /pricing/);
});

test("rate component sums and approval priorities must remain safe integers", () => {
  const unsafeSum = decide({
    rates: {
      [baseline]: baselineRate,
      "gpt-mini-upgrade": {
        input: Number.MAX_SAFE_INTEGER,
        output: 1,
        unit: 1,
        version: "unsafe-sum",
      },
    },
  });
  assert.equal(unsafeSum.selected, baseline);
  assert.match(unsafeSum.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /pricing/);

  for (const priority of [Number.MAX_SAFE_INTEGER + 1, Number.NaN, 1.5]) {
    const result = decide({
      approved: [model(baseline), model("gpt-mini-upgrade", undefined, priority)],
    });
    assert.equal(result.selected, baseline);
    assert.match(result.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /priority/);
  }
});

test("a promotion cannot increase any individual billing dimension", () => {
  const higherRates: LockedModelRate[] = [
    { input: baselineRate.input + 1, output: baselineRate.output, unit: baselineRate.unit, version: "v" },
    { input: baselineRate.input, output: baselineRate.output + 1, unit: baselineRate.unit, version: "v" },
    { input: baselineRate.input, output: baselineRate.output, unit: baselineRate.unit + 1, version: "v" },
  ];
  for (const rate of higherRates) {
    const result = decide({ rates: { [baseline]: baselineRate, "gpt-mini-upgrade": rate } });
    assert.equal(result.selected, baseline);
    assert.match(result.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /ceiling/);
  }
});

test("pins are preserved and fail closed if the pinned model is no longer catalogued", () => {
  const preserved = decide({ pinned: true });
  assert.equal(preserved.selected, baseline);
  assert.equal(preserved.reason, "pinned");
  assert.deepEqual(preserved.blocked, []);

  const absent = decide({ pinned: true, catalog: [{ id: "gpt-mini-upgrade" }] });
  assert.equal(absent.selected, null);
  assert.equal(absent.reason, "unavailable");
  assert.equal(firstBlocked(absent).id, baseline);
});

test("pins require an approved same-tier contract and supported Gemini operation", () => {
  const unapproved = decide({
    pinned: true,
    approved: [model("gpt-mini-upgrade")],
  });
  assert.equal(unapproved.selected, null);
  assert.equal(unapproved.reason, "unavailable");
  assert.match(firstBlocked(unapproved).reason, /contract unapproved/);

  const wrongContract = decide({
    pinned: true,
    approved: [model(baseline, MODEL_CONTRACTS.geminiImage), model("gpt-mini-upgrade")],
  });
  assert.equal(wrongContract.selected, null);
  assert.match(firstBlocked(wrongContract).reason, /contract unapproved/);

  const wrongOperation = selectTierModel({
    tier: "geminiFlash",
    configured: "gemini-pinned",
    pinned: true,
    catalog: [
      { id: "gemini-pinned", methods: ["predictLongRunning"] },
      { id: "gemini-alternative", methods: ["generateContent"] },
    ],
    approved: [
      { id: "gemini-pinned", priority: 1, contract: MODEL_CONTRACTS.geminiFlash },
      { id: "gemini-alternative", priority: 2, contract: MODEL_CONTRACTS.geminiFlash },
    ],
    rates: {},
  });
  assert.equal(wrongOperation.selected, null);
  assert.equal(wrongOperation.reason, "unavailable");
  assert.match(firstBlocked(wrongOperation).reason, /contract unapproved/);
});

test("Gemini text tiers require generateContent and Veo requires predictLongRunning", () => {
  const text = (methods?: string[]) => selectTierModel({
    tier: "geminiFlash",
    configured: "gemini-current",
    pinned: false,
    catalog: [{ id: "gemini-current", methods: ["generateContent"] }, { id: "gemini-next", methods }],
    approved: [
      { id: "gemini-current", priority: 1, contract: MODEL_CONTRACTS.geminiFlash },
      { id: "gemini-next", priority: 2, contract: MODEL_CONTRACTS.geminiFlash },
    ],
    rates: {
      "gemini-current": baselineRate,
      "gemini-next": equalRate,
    },
  });
  const textBlocked = text(["predictLongRunning"]);
  assert.equal(textBlocked.selected, "gemini-current");
  assert.match(firstBlocked(textBlocked).reason, /operation/);
  assert.equal(text(["generateContent"]).selected, "gemini-next");

  const veo = (methods?: string[]) => selectTierModel({
    tier: "veoVideo",
    configured: "veo-current",
    pinned: false,
    catalog: [{ id: "veo-current", methods: ["predictLongRunning"] }, { id: "veo-next", methods }],
    approved: [
      { id: "veo-current", priority: 1, contract: MODEL_CONTRACTS.veoVideo },
      { id: "veo-next", priority: 2, contract: MODEL_CONTRACTS.veoVideo },
    ],
    rates: { "veo-current": baselineRate, "veo-next": equalRate },
  });
  const veoBlocked = veo(["generateContent"]);
  assert.equal(veoBlocked.selected, "veo-current");
  assert.match(firstBlocked(veoBlocked).reason, /operation/);
  assert.equal(veo(["predictLongRunning"]).selected, "veo-next");
});

test("candidates with a contract for a different request shape are rejected", () => {
  const result = decide({
    approved: [
      model(baseline),
      model("gpt-mini-upgrade", MODEL_CONTRACTS.geminiImage, 2),
    ],
  });
  assert.equal(result.selected, baseline);
  assert.match(result.blocked.find(item => item.id === "gpt-mini-upgrade")!.reason, /contract/);
});

test("when the configured model is gone, selection uses a live approved priced alternative", () => {
  const result = decide({
    configured: "gpt-mini-retired",
    catalog: [{ id: "gpt-mini-fallback" }],
    approved: [model("gpt-mini-fallback", undefined, 1)],
    rates: {
      "gpt-mini-retired": baselineRate,
      "gpt-mini-fallback": equalRate,
    },
  });
  assert.equal(result.selected, "gpt-mini-fallback");
});

test("equal priorities resolve deterministically by ID", () => {
  const options = {
    catalog: [{ id: baseline }, { id: "candidate-z" }, { id: "candidate-a" }],
    approved: [model(baseline), model("candidate-z", undefined, 5), model("candidate-a", undefined, 5)],
    rates: { [baseline]: baselineRate, "candidate-z": equalRate, "candidate-a": equalRate },
  };
  const first = decide(options);
  const second = decide({ ...options, catalog: [...options.catalog].reverse(), approved: [...options.approved].reverse() });
  assert.equal(first.selected, "candidate-a");
  assert.deepEqual(second, first);
});

test("an image tier cannot fall back to text-generation candidates", () => {
  const result = decide({
    tier: "geminiImage",
    configured: "image-current",
    catalog: [{ id: "text-model", methods: ["generateContent"] }],
    approved: [{ id: "text-model", priority: 100, contract: MODEL_CONTRACTS.geminiFlash }],
    rates: { "image-current": baselineRate, "text-model": equalRate },
  });
  assert.equal(result.selected, null);
  assert.equal(result.reason, "unavailable");
});

test("image upgrades require image and token pricing and reject hidden higher modality components", () => {
  const imageBaseline: LockedModelRate = {
    input: 10, output: 20, unit: 30, version: "image-base",
    dimensions: {
      images: { input: 2, output: 10, unit: 1 },
      tokens: { input: 3, output: 8, unit: 1 },
    },
  };
  const imageUpgrade: LockedModelRate = {
    input: 10, output: 20, unit: 30, version: "image-next",
    dimensions: {
      images: { input: 2, output: 10, unit: 1 },
      tokens: { input: 3, output: 8, unit: 1 },
    },
  };
  const chooseImage = (candidateRate: LockedModelRate) => selectTierModel({
    tier: "geminiImage",
    configured: "image-current",
    pinned: false,
    catalog: [
      { id: "image-current", methods: ["generateContent"] },
      { id: "image-upgrade", methods: ["generateContent"] },
    ],
    approved: [
      { id: "image-current", priority: 1, contract: MODEL_CONTRACTS.geminiImage },
      { id: "image-upgrade", priority: 2, contract: MODEL_CONTRACTS.geminiImage },
    ],
    rates: { "image-current": imageBaseline, "image-upgrade": candidateRate },
  });

  assert.equal(chooseImage(imageUpgrade).selected, "image-upgrade");

  const missingDimensions = chooseImage({ ...imageUpgrade, dimensions: undefined });
  assert.equal(missingDimensions.selected, "image-current");
  assert.match(firstBlocked(missingDimensions).reason, /modality-specific/);

  const hiddenHigherComponent = chooseImage({
    ...imageUpgrade,
    dimensions: {
      images: { input: 1, output: 11, unit: 1 },
      tokens: { input: 3, output: 8, unit: 1 },
    },
  });
  assert.equal(hiddenHigherComponent.selected, "image-current");
  assert.match(firstBlocked(hiddenHigherComponent).reason, /modality-specific cost ceiling/);
});

test("configured baseline remains selected when every promotion is blocked", () => {
  const result = decide({
    catalog: [{ id: baseline }, { id: "gpt-mini-upgrade" }],
    approved: [model(baseline), model("gpt-mini-upgrade", undefined, 2)],
    rates: {
      [baseline]: baselineRate,
      "gpt-mini-upgrade": { input: 11, output: 20, unit: 30, version: "too-expensive" },
    },
  });
  assert.equal(result.selected, baseline);
  assert.equal(result.reason, "fallback");
});

test("selection does not mutate any supplied policy inputs", () => {
  const input = {
    tier: "gptMini" as const,
    configured: baseline,
    pinned: false,
    catalog: [{ id: baseline }, { id: "gpt-mini-upgrade" }],
    approved: [model(baseline), model("gpt-mini-upgrade", undefined, 2)],
    rates: { [baseline]: { ...baselineRate }, "gpt-mini-upgrade": { ...equalRate } },
  };
  const before = structuredClone(input);
  selectTierModel(input);
  assert.deepEqual(input, before);
});
