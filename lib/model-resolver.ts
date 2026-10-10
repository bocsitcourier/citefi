/**
 * Shared web/worker model policy. Requests await resolution, then freeze the
 * selected ID for both submission and its accounting receipt.
 */
import {
  GEMINI_FLASH_MODEL, GEMINI_ARTICLE_MODEL, GEMINI_PRO_MODEL,
  GEMINI_CRITIQUE_MODEL, GEMINI_IMAGE_MODEL, VEO_VIDEO_MODEL,
  GPT_ENHANCEMENT_MODEL, GPT_REVIEW_MODEL, GPT_ADVANCED_MODEL,
  GPT_HYPERLINK_EXTRACT_MODEL, GPT_HYPERLINK_CORRECTION_MODEL, TTS_MODEL,
} from "./ai-config";
import { PipelineError } from "./errors";
import { fetchModelCatalog } from "./model-catalog";
import { approvedModels } from "./model-upgrade-registry";
import {
  MODEL_CONTRACTS, modelProvider, selectTierModel, type CatalogModel, type LockedModelRate,
  type ModelDecision, type ModelTier,
} from "./model-policy";
export type { ModelTier } from "./model-policy";

const DEFAULTS: Record<ModelTier, string> = {
  geminiFlash: GEMINI_FLASH_MODEL, geminiArticle: GEMINI_ARTICLE_MODEL,
  geminiPro: GEMINI_PRO_MODEL, geminiCritique: GEMINI_CRITIQUE_MODEL,
  geminiImage: GEMINI_IMAGE_MODEL, veoVideo: VEO_VIDEO_MODEL,
  gptMini: GPT_ENHANCEMENT_MODEL, gptReview: GPT_REVIEW_MODEL,
  gptAdvanced: GPT_ADVANCED_MODEL, gptHyperlinkExtract: GPT_HYPERLINK_EXTRACT_MODEL,
  gptHyperlinkCorrection: GPT_HYPERLINK_CORRECTION_MODEL, tts: TTS_MODEL,
};
const ENV_PINS: Record<ModelTier, string> = {
  geminiFlash: "GEMINI_FLASH_MODEL", geminiArticle: "GEMINI_ARTICLE_MODEL",
  geminiPro: "GEMINI_PRO_MODEL", geminiCritique: "GEMINI_CRITIQUE_MODEL",
  geminiImage: "GEMINI_IMAGE_MODEL", veoVideo: "VEO_VIDEO_MODEL",
  gptMini: "GPT_ENHANCEMENT_MODEL", gptReview: "GPT_REVIEW_MODEL",
  gptAdvanced: "GPT_ADVANCED_MODEL", gptHyperlinkExtract: "GPT_HYPERLINK_EXTRACT_MODEL",
  gptHyperlinkCorrection: "GPT_HYPERLINK_CORRECTION_MODEL", tts: "TTS_MODEL",
};
const PINS = new Set((Object.keys(ENV_PINS) as ModelTier[])
  .filter(tier => !!process.env[ENV_PINS[tier]]?.trim()));
const CRITICAL_TIERS: ModelTier[] = ["geminiFlash", "geminiArticle", "geminiPro", "gptMini", "gptAdvanced"];
export const MODEL_REFRESH_MS = 30 * 60_000;
export const MODEL_MAX_STALE_MS = 2 * 60 * 60_000;
const RETRY_MS = 60_000;

interface ProviderState {
  available: boolean;
  checkedAt: number;
  lastSuccessAt: number | null;
  models: CatalogModel[];
  error?: string;
}
const providers: Record<"gemini" | "openai", ProviderState> = {
  gemini: { available: false, checkedAt: 0, lastSuccessAt: null, models: [] },
  openai: { available: false, checkedAt: 0, lastSuccessAt: null, models: [] },
};
let selected: Partial<Record<ModelTier, string>> = {};
let decisions: Partial<Record<ModelTier, ModelDecision>> = {};
let flight: Promise<void> | null = null;
let nextCheckAt = 0;
let initialized = false;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastChanges: Array<{ tier: ModelTier; from: string | null; to: string | null; at: string }> = [];
const rejectedUntil = new Map<string, number>();
let invalidationEpoch = 0;
let rateReader: ModelResolverDependencies["rates"];

function usable(tier: ModelTier, now = Date.now()): boolean {
  const state = providers[modelProvider(tier)];
  return !!selected[tier] && state.lastSuccessAt != null &&
    now - state.lastSuccessAt <= MODEL_MAX_STALE_MS;
}
/** Synchronous compatibility accessor; generation paths use getResolvedModel. */
export function getModel(tier: ModelTier): string {
  if (!initialized) return DEFAULTS[tier];
  if (!usable(tier)) throw new PipelineError(
    `No validated model available for ${tier}`, "MODEL_NOT_FOUND", "fatal", "model-resolution",
  );
  return selected[tier]!;
}
export async function getResolvedModel(tier: ModelTier): Promise<string> {
  await refreshModelResolution();
  // Revalidate promotions at each operation boundary: a newly effective rate
  // must not leave a promoted model authorized until the catalog TTL expires.
  if (usable(tier) && selected[tier] !== DEFAULTS[tier] && !PINS.has(tier)) {
    let rates: Record<string, LockedModelRate> = {};
    try {
      const reader = rateReader ?? (await import("./model-rate-eligibility")).readModelPromotionRates;
      rates = await reader(tier, [DEFAULTS[tier], ...approvedModels(tier).map(candidate => candidate.id)]);
    } catch { /* Missing pricing cannot authorize a promotion. */ }
    const decision = selectTierModel({
      tier, configured: DEFAULTS[tier], pinned: false,
      catalog: providers[modelProvider(tier)].models.filter(model =>
        (rejectedUntil.get(model.id) ?? 0) <= Date.now()),
      approved: providers[modelProvider(tier)].available ? approvedModels(tier)
        : approvedModels(tier).filter(candidate => candidate.id === selected[tier] || candidate.id === DEFAULTS[tier]),
      rates,
    });
    if (selected[tier] !== decision.selected) {
      lastChanges.push({ tier, from: selected[tier] ?? null, to: decision.selected, at: new Date().toISOString() });
      lastChanges = lastChanges.slice(-100);
    }
    if (decision.selected) selected[tier] = decision.selected;
    else delete selected[tier];
    decisions[tier] = decision;
  }
  return getModel(tier);
}
export function getAllModels(): Record<ModelTier, string> {
  if (!initialized) return { ...DEFAULTS };
  return Object.fromEntries((Object.keys(DEFAULTS) as ModelTier[])
    .map(tier => [tier, usable(tier) ? selected[tier] : "unavailable"])) as Record<ModelTier, string>;
}
export function isResolverReady(): boolean {
  return initialized && CRITICAL_TIERS.every(tier =>
    usable(tier) && providers[modelProvider(tier)].available);
}
export interface GeminiModelValidationStatus {
  checked: boolean; available: boolean; configuredModels: string[];
  unrecognizedModels: string[]; checkedAt: string | null; error?: string;
}
export function getGeminiValidationStatus(): GeminiModelValidationStatus {
  const state = providers.gemini;
  const configured = [...new Set((Object.keys(DEFAULTS) as ModelTier[])
    .filter(tier => modelProvider(tier) === "gemini").map(tier => DEFAULTS[tier]))];
  return {
    checked: state.checkedAt > 0, available: state.available, configuredModels: configured,
    unrecognizedModels: state.available ? configured.filter(id => !state.models.some(model => model.id === id)) : [],
    checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
    ...(state.error ? { error: state.error } : {}),
  };
}
export function getModelResolutionStatus() {
  return {
    scope: process.env.WORKER_PROCESS === "true" ? "worker-process" : "web-process",
    ready: isResolverReady(), initialized, refreshIntervalMs: MODEL_REFRESH_MS,
    maxStaleMs: MODEL_MAX_STALE_MS, pins: [...PINS],
    tiers: (Object.keys(DEFAULTS) as ModelTier[]).map(tier => ({
      ...decisions[tier], tier, configured: DEFAULTS[tier],
      selected: usable(tier) ? selected[tier] : null, usable: usable(tier),
    })),
    providers: Object.fromEntries(Object.entries(providers).map(([name, state]) => [
      name, {
        available: state.available, checkedAt: state.checkedAt ? new Date(state.checkedAt).toISOString() : null,
        lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
        modelCount: state.models.length, ...(state.error ? { error: state.error } : {}),
        unapproved: state.models.filter(model => /^(gpt|gemini|veo|chatgpt)-/.test(model.id) &&
          !(Object.keys(DEFAULTS) as ModelTier[]).some(tier =>
            modelProvider(tier) === name && approvedModels(tier).some(candidate => candidate.id === model.id)
          )).map(model => ({ id: model.id, reason: "Compatibility and locked-pricing certification required" })).slice(0, 100),
      },
    ])),
    changes: lastChanges.map(change => ({ ...change })),
  };
}

export interface ModelResolverDependencies {
  catalog?: (provider: "gemini" | "openai", key: string | undefined) => Promise<CatalogModel[]>;
  rates?: (tier: ModelTier, ids: string[]) => Promise<Record<string, LockedModelRate>>;
  now?: () => number;
}
async function refresh(dependencies: ModelResolverDependencies): Promise<void> {
  const now = dependencies.now?.() ?? Date.now();
  const epoch = invalidationEpoch;
  rateReader = dependencies.rates;
  await Promise.all((["gemini", "openai"] as const).map(async provider => {
    const state = providers[provider];
    state.checkedAt = now;
    try {
      const models = await (dependencies.catalog ?? fetchModelCatalog)(provider,
        process.env[provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY"]);
      if (!models.length) throw new Error("Empty catalog");
      state.models = models;
      state.available = true;
      state.lastSuccessAt = now;
      delete state.error;
    } catch {
      state.available = false;
      // Never include raw SDK/fetch errors: they can contain credentials.
      state.error = `${provider} model catalog unavailable; no new promotions permitted`;
    }
  }));
  const next: Partial<Record<ModelTier, string>> = {};
  const nextDecisions: Partial<Record<ModelTier, ModelDecision>> = {};
  await Promise.all((Object.keys(DEFAULTS) as ModelTier[]).map(async tier => {
    const state = providers[modelProvider(tier)];
    if (!state.available) {
      if (selected[tier] && state.lastSuccessAt != null && now - state.lastSuccessAt <= MODEL_MAX_STALE_MS)
        next[tier] = selected[tier];
      nextDecisions[tier] = {
        tier, selected: next[tier] ?? null, reason: next[tier] ? "fallback" : "unavailable",
        blocked: [{ id: DEFAULTS[tier], reason: state.error! }],
      };
      return;
    }
    const approved = approvedModels(tier);
    const availableCatalog = state.models.filter(model => (rejectedUntil.get(model.id) ?? 0) <= now);
    // A pin is not permission to bypass a capability contract.
    const configuredPriority = approved.find(candidate => candidate.id === DEFAULTS[tier])?.priority ?? 0;
    const needsRates = !PINS.has(tier) && approved.some(candidate =>
      candidate.id !== DEFAULTS[tier] && availableCatalog.some(model => model.id === candidate.id) &&
      (candidate.priority > configuredPriority || !availableCatalog.some(model => model.id === DEFAULTS[tier])));
    let rates: Record<string, LockedModelRate> = {};
    let pricingFailed = false;
    if (needsRates) {
      try {
        const reader = dependencies.rates ?? (await import("./model-rate-eligibility")).readModelPromotionRates;
        rates = await reader(tier, [DEFAULTS[tier], ...approved.map(candidate => candidate.id)]);
      } catch { pricingFailed = true; }
    }
    const decision = selectTierModel({
      tier, configured: DEFAULTS[tier], pinned: PINS.has(tier),
      catalog: availableCatalog,
      approved, rates,
    });
    if (pricingFailed) decision.blocked.push({ id: DEFAULTS[tier], reason: "Locked pricing lookup unavailable; no promotion permitted" });
    if (decision.selected) next[tier] = decision.selected;
    nextDecisions[tier] = decision;
  }));
  for (const tier of Object.keys(DEFAULTS) as ModelTier[]) {
    if (next[tier] && (rejectedUntil.get(next[tier]!) ?? 0) > now) {
      const rejected = next[tier]!;
      delete next[tier];
      nextDecisions[tier] = {
        tier, selected: null, reason: "unavailable",
        blocked: [{ id: rejected, reason: "Model rejected while refresh was in flight" }],
      };
    }
    if (selected[tier] !== next[tier]) lastChanges.push({
      tier, from: selected[tier] ?? null, to: next[tier] ?? null, at: new Date(now).toISOString(),
    });
  }
  lastChanges = lastChanges.slice(-100);
  // Commit all decisions together; in-flight operations retain captured IDs.
  selected = next; decisions = nextDecisions; initialized = true;
  nextCheckAt = epoch !== invalidationEpoch ? 0 : now +
    (Object.values(providers).every(state => state.available) ? MODEL_REFRESH_MS : RETRY_MS);
}

/** Single-flight, bounded metadata refresh shared by all callers in this process. */
export function refreshModelResolution(force = false, dependencies: ModelResolverDependencies = {}): Promise<void> {
  if (flight) return flight;
  if (!force && (dependencies.now?.() ?? Date.now()) < nextCheckAt) return Promise.resolve();
  flight = refresh(dependencies).finally(() => { flight = null; });
  return flight;
}
export async function validateAndResolveModels(): Promise<void> {
  await refreshModelResolution(true);
  if (!isResolverReady()) throw new PipelineError(
    "Critical model tiers have no fresh verified catalog selection", "MODEL_NOT_FOUND", "fatal", "startup",
  );
  console.log("[model-resolver] Selected models:", JSON.stringify(getAllModels()));
}
/** Refresh only. Never replay a possibly billed provider submission. */
export async function reResolveAfterModelNotFound(_tier: ModelTier): Promise<void> {
  if (selected[_tier]) notifyModelNotFound(selected[_tier]!);
  await refreshModelResolution(true);
}
/** Quarantine a confirmed model-specific rejection; never resubmit the attempt. */
export function notifyModelNotFound(model: string): void {
  if (!(Object.keys(DEFAULTS) as ModelTier[]).some(tier =>
    selected[tier] === model || DEFAULTS[tier] === model)) return;
  rejectedUntil.set(model, Date.now() + MODEL_REFRESH_MS);
  invalidationEpoch++;
  for (const tier of Object.keys(DEFAULTS) as ModelTier[]) {
    if (selected[tier] === model) {
      delete selected[tier];
      decisions[tier] = {
        tier, selected: null, reason: "unavailable",
        blocked: [{ id: model, reason: "Confirmed model rejection; quarantined pending refresh" }],
      };
    }
  }
  nextCheckAt = 0;
}
export function startModelRefresh(onRefresh?: (ready: boolean) => Promise<unknown>): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void refreshModelResolution().then(() => onRefresh?.(isResolverReady()))
      .catch(() => { /* Current selection remains bounded by expiry. */ });
  }, RETRY_MS);
  refreshTimer.unref();
}
export function stopModelRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}
