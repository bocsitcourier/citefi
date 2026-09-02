/**
 * Level 2 model resolver — validates configured model IDs against the live API
 * at worker startup, falls back through a verified chain when a model is gone,
 * and refuses to start if a critical tier has no live option.
 *
 * Design: the resolved map is private. The only way to read a model ID at
 * runtime is getModel(tier). If called before validateAndResolveModels() has
 * run, it throws a PipelineError so the bug surfaces immediately with a stack
 * trace pointing at the offending file — instead of silently returning
 * undefined or a stale import-time capture.
 *
 * Usage (server/worker-process.ts):
 *   await validateAndResolveModels();  // before registerWorkers()
 *
 * Usage (lib/*.ts that call AI APIs):
 *   import { getModel } from "./model-resolver";
 *   model: getModel("geminiFlash")
 */

import {
  GEMINI_FLASH_MODEL,
  GEMINI_ARTICLE_MODEL,
  GEMINI_PRO_MODEL,
  GEMINI_CRITIQUE_MODEL,
  GEMINI_IMAGE_MODEL,
  VEO_VIDEO_MODEL,
  GPT_ENHANCEMENT_MODEL,
  GPT_REVIEW_MODEL,
  GPT_ADVANCED_MODEL,
  GPT_HYPERLINK_EXTRACT_MODEL,
  GPT_HYPERLINK_CORRECTION_MODEL,
  TTS_MODEL,
  GEMINI_EXPERIMENTAL_MODEL,
} from "./ai-config";
import { PipelineError } from "./errors";

// ── Tier type ─────────────────────────────────────────────────────────────────

export type ModelTier =
  | "geminiFlash"
  | "geminiArticle"
  | "geminiPro"
  | "geminiCritique"
  | "geminiImage"
  | "veoVideo"
  | "gptMini"
  | "gptReview"
  | "gptAdvanced"
  | "gptHyperlinkExtract"
  | "gptHyperlinkCorrection"
  | "tts";

// ── Private resolved map ──────────────────────────────────────────────────────
// null = resolver hasn't run yet; getModel() throws in this state.

let _resolved: Record<ModelTier, string> | null = null;

export interface GeminiModelValidationStatus {
  checked: boolean;
  available: boolean;
  configuredModels: string[];
  unrecognizedModels: string[];
  checkedAt: string | null;
  error?: string;
}

let _geminiValidation: GeminiModelValidationStatus = {
  checked: false,
  available: false,
  configuredModels: [],
  unrecognizedModels: [],
  checkedAt: null,
};

// Defaults initialised from ai-config (env-overridable)
const DEFAULTS: Record<ModelTier, string> = {
  geminiFlash:            GEMINI_FLASH_MODEL,
  geminiArticle:          GEMINI_ARTICLE_MODEL,
  geminiPro:              GEMINI_PRO_MODEL,
  geminiCritique:         GEMINI_CRITIQUE_MODEL,
  geminiImage:            GEMINI_IMAGE_MODEL,
  veoVideo:               VEO_VIDEO_MODEL,
  gptMini:                GPT_ENHANCEMENT_MODEL,
  gptReview:              GPT_REVIEW_MODEL,
  gptAdvanced:            GPT_ADVANCED_MODEL,
  gptHyperlinkExtract:    GPT_HYPERLINK_EXTRACT_MODEL,
  gptHyperlinkCorrection: GPT_HYPERLINK_CORRECTION_MODEL,
  tts:                    TTS_MODEL,
};

// ── Public accessor ───────────────────────────────────────────────────────────

/**
 * Get the live-validated model ID for a tier.
 * Throws if called before validateAndResolveModels() has run.
 */
export function getModel(tier: ModelTier): string {
  if (_resolved !== null) return _resolved[tier];
  // Pre-resolution fallback: web process routes call AI directly before the
  // worker resolver has run. Return the static verified default so they keep
  // working during the SEAM3 migration; log loudly so violations are visible.
  // The strict "throw" behavior will return once all 15 sync routes are
  // converted to queued jobs and WORKER_PROCESS enforcement is enabled.
  console.warn(
    `[model-resolver] getModel("${tier}") before resolution — using static default. ` +
    `This call is in the web process and should be queued (Seam 3 violation).`
  );
  return DEFAULTS[tier];
}

/**
 * Returns a snapshot of all resolved model IDs.
 * Returns the defaults if the resolver hasn't run yet (for /api/health).
 */
export function getAllModels(): Record<ModelTier, string> {
  return _resolved ? { ..._resolved } : { ...DEFAULTS };
}

/** True once validateAndResolveModels() has completed successfully. */
export function isResolverReady(): boolean {
  return _resolved !== null;
}

/** Cached result of the one-time startup Gemini ListModels check. */
export function getGeminiValidationStatus(): GeminiModelValidationStatus {
  return {
    ..._geminiValidation,
    configuredModels: [..._geminiValidation.configuredModels],
    unrecognizedModels: [..._geminiValidation.unrecognizedModels],
  };
}

// ── Known shutdown dates ──────────────────────────────────────────────────────
const KNOWN_SHUTDOWNS: Record<string, string> = {
  "gemini-2.5-pro": "2026-10-16 (Gemini Developer API — migrate to gemini-3.1-pro-preview)",
  "gemini-2.0-flash-exp": "2026-06-01",
  "veo-2.0-generate-001": "removed",
};

// ── Fallback chains ───────────────────────────────────────────────────────────
// Verified against live ListModels / /v1/models responses (2026-08).

const GEMINI_CHAINS: Record<ModelTier, string[]> = {
  geminiFlash:    ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiArticle:  ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiPro:      ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-3.5-flash"],
  geminiCritique: ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash"],
  geminiImage:    ["gemini-2.5-flash-image", "gemini-3.1-flash-image", "gemini-2.5-flash"],
  // Veo validated separately; keep configured value as-is
  veoVideo: [],
  // OpenAI handled below
  gptMini: [], gptReview: [], gptAdvanced: [],
  gptHyperlinkExtract: [], gptHyperlinkCorrection: [], tts: [],
};

const OPENAI_CHAINS: Record<ModelTier, string[]> = {
  gptMini:                ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptReview:              ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptAdvanced:            ["gpt-4.1", "gpt-4.1-2025-04-14", "gpt-4o"],
  gptHyperlinkExtract:    ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptHyperlinkCorrection: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  tts:                    ["gpt-4o-mini-tts"],
  // Not OpenAI
  geminiFlash: [], geminiArticle: [], geminiPro: [], geminiCritique: [],
  geminiImage: [], veoVideo: [],
};

const CRITICAL_TIERS = new Set<ModelTier>([
  "geminiFlash", "geminiArticle", "geminiPro", "gptMini", "gptAdvanced",
]);

// ── API helpers ───────────────────────────────────────────────────────────────

async function listGeminiModels(): Promise<Set<string>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    _geminiValidation = {
      checked: true,
      available: false,
      configuredModels: [],
      unrecognizedModels: [],
      checkedAt: new Date().toISOString(),
      error: "GEMINI_API_KEY is not set",
    };
    console.warn("⚠️ [model-resolver] GEMINI_API_KEY not set — skipping Gemini validation");
    return new Set();
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { models?: Array<{ name: string }> };
    const ids = new Set<string>();
    for (const m of data.models ?? []) {
      ids.add(m.name.replace(/^models\//, ""));
    }
    const configuredModels = [
      GEMINI_ARTICLE_MODEL,
      GEMINI_FLASH_MODEL,
      GEMINI_PRO_MODEL,
      GEMINI_EXPERIMENTAL_MODEL,
      GEMINI_CRITIQUE_MODEL,
      GEMINI_IMAGE_MODEL,
      VEO_VIDEO_MODEL,
    ];
    const unrecognizedModels = [...new Set(configuredModels)].filter((id) => !ids.has(id));
    _geminiValidation = {
      checked: true,
      available: true,
      configuredModels: [...new Set(configuredModels)],
      unrecognizedModels,
      checkedAt: new Date().toISOString(),
    };
    for (const modelId of unrecognizedModels) {
      console.warn(`⚠️ [model-resolver] Gemini model ID "${modelId}" is not present in live ListModels`);
    }
    console.log(
      `🔎 [model-resolver] Gemini startup check: ${configuredModels.length - unrecognizedModels.length}/${configuredModels.length} configured IDs recognized`
    );
    return ids;
  } catch (err) {
    _geminiValidation = {
      checked: true,
      available: false,
      configuredModels: [
        ...new Set([
          GEMINI_ARTICLE_MODEL,
          GEMINI_FLASH_MODEL,
          GEMINI_PRO_MODEL,
          GEMINI_EXPERIMENTAL_MODEL,
          GEMINI_CRITIQUE_MODEL,
          GEMINI_IMAGE_MODEL,
          VEO_VIDEO_MODEL,
        ]),
      ],
      unrecognizedModels: [],
      checkedAt: new Date().toISOString(),
      error: (err as Error).message,
    };
    console.warn(`⚠️ [model-resolver] Gemini ListModels failed: ${(err as Error).message} — worker will continue`);
    return new Set();
  }
}

async function listOpenAIModels(): Promise<Set<string>> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn("⚠️ [model-resolver] OPENAI_API_KEY not set — skipping OpenAI validation");
    return new Set();
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { data?: Array<{ id: string }> };
    return new Set((data.data ?? []).map((m) => m.id));
  } catch (err) {
    console.warn(`⚠️ [model-resolver] OpenAI /v1/models failed: ${(err as Error).message} — skipping OpenAI validation`);
    return new Set();
  }
}

// ── Core resolver ─────────────────────────────────────────────────────────────

function resolveOneTier(
  tier: ModelTier,
  current: string,
  liveModels: Set<string>,
  chain: string[],
  working: Record<ModelTier, string>,
  errors: string[]
): void {
  if (chain.length === 0) return;

  if (KNOWN_SHUTDOWNS[current]) {
    console.warn(`⚠️ [model-resolver] ${tier}: "${current}" has a known shutdown date: ${KNOWN_SHUTDOWNS[current]}`);
  }

  if (liveModels.size === 0) return; // API call failed — trust configured value

  if (liveModels.has(current)) {
    console.log(`   ✅ ${tier}: ${current}`);
    return;
  }

  const fallback = chain.find((m) => liveModels.has(m));
  if (fallback) {
    console.warn(`   ⚠️  ${tier}: "${current}" not in ListModels — falling back to "${fallback}"`);
    working[tier] = fallback;
  } else {
    const msg = `${tier}: "${current}" is gone and no fallback in [${chain.join(", ")}] is live`;
    if (CRITICAL_TIERS.has(tier)) {
      errors.push(msg);
    } else {
      console.warn(`   ⚠️  [model-resolver] Non-critical ${msg} — using configured value`);
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Call once at worker startup, before registerWorkers().
 * Populates the private resolved map. Throws if any critical tier has no live model.
 * After this returns, getModel() works.
 */
export async function validateAndResolveModels(): Promise<void> {
  console.log("🔍 [model-resolver] Validating AI model IDs against live APIs...");

  // Start from defaults; resolver updates working copy then commits atomically
  const working: Record<ModelTier, string> = { ...DEFAULTS };

  const [geminiLive, openaiLive] = await Promise.all([
    listGeminiModels(),
    listOpenAIModels(),
  ]);

  const errors: string[] = [];

  console.log("   Gemini tiers:");
  for (const tier of Object.keys(GEMINI_CHAINS) as ModelTier[]) {
    if (GEMINI_CHAINS[tier].length > 0) {
      resolveOneTier(tier, working[tier], geminiLive, GEMINI_CHAINS[tier], working, errors);
    }
  }

  console.log("   OpenAI tiers:");
  for (const tier of Object.keys(OPENAI_CHAINS) as ModelTier[]) {
    if (OPENAI_CHAINS[tier].length > 0) {
      resolveOneTier(tier, working[tier], openaiLive, OPENAI_CHAINS[tier], working, errors);
    }
  }

  console.log(`   ℹ️  veoVideo: ${working.veoVideo} (not validated — Veo uses a separate endpoint)`);

  if (errors.length > 0) {
    throw new PipelineError(
      `Critical model tiers have no live model: ${errors.join("; ")}`,
      "MODEL_NOT_FOUND",
      "fatal",
      "startup",
    );
  }

  // Atomic commit — getModel() unblocks after this line
  _resolved = working;

  console.log("✅ [model-resolver] All model tiers resolved. Workers will use:");
  console.log(`   Gemini flash/article : ${_resolved.geminiFlash}`);
  console.log(`   Gemini pro           : ${_resolved.geminiPro}`);
  console.log(`   Gemini critique      : ${_resolved.geminiCritique}`);
  console.log(`   Gemini image         : ${_resolved.geminiImage}`);
  console.log(`   Veo video            : ${_resolved.veoVideo}`);
  console.log(`   GPT mini (16 files)  : ${_resolved.gptMini}`);
  console.log(`   GPT advanced         : ${_resolved.gptAdvanced}`);
  console.log(`   TTS                  : ${_resolved.tts}`);
}

/**
 * Call when a model API returns 404/NOT_FOUND mid-flight.
 * Re-runs validation so the next job picks up an updated model.
 */
export async function reResolveAfterModelNotFound(tier: ModelTier): Promise<void> {
  console.warn(`🔄 [model-resolver] 404 for ${tier} — re-running resolver`);
  await validateAndResolveModels();
}
