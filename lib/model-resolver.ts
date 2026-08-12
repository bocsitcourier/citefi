/**
 * Level 2 model resolver — validates configured model IDs against the live API
 * at worker startup, falls back through a verified chain when a model is gone,
 * and refuses to start if a critical tier has no live option.
 *
 * All runtime code should read from RESOLVED_MODELS rather than importing the
 * static string constants from ai-config.ts. The resolver updates RESOLVED_MODELS
 * in place before any worker processes jobs.
 *
 * Usage (in server/worker-process.ts):
 *   await validateAndResolveModels();  // before registerWorkers()
 *
 * Usage (in lib/*.ts that call AI APIs):
 *   import { RESOLVED_MODELS } from "./model-resolver";
 *   model: RESOLVED_MODELS.geminiFlash
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
} from "./ai-config";

// ── Mutable live config ───────────────────────────────────────────────────────
// Initialised from ai-config defaults. validateAndResolveModels() updates these
// in place before any jobs run, so all callers always see the resolved value.

export const RESOLVED_MODELS = {
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

// ── Known shutdown dates ──────────────────────────────────────────────────────
// Emit a deprecation warning at startup even when the model is still live.
const KNOWN_SHUTDOWNS: Record<string, string> = {
  "gemini-2.5-pro": "2026-10-16 (Gemini Developer API — migrate to gemini-3.1-pro-preview)",
  "gemini-2.0-flash-exp": "2026-06-01",
  "veo-2.0-generate-001": "removed",
};

// ── Fallback chains ───────────────────────────────────────────────────────────
// Verified against live ListModels / /v1/models responses (2026-08).
// Resolver picks the first model in the chain that appears in the live list.

const GEMINI_CHAINS: Record<keyof typeof RESOLVED_MODELS, string[]> = {
  geminiFlash:    ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiArticle:  ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiPro:      ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-3.5-flash"],
  geminiCritique: ["gemini-2.5-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash"],
  geminiImage:    ["gemini-2.5-flash-image", "gemini-3.1-flash-image", "gemini-2.5-flash"],
  // Veo validated separately (different endpoint); keep configured value as-is
  veoVideo:       [],
  // Not Gemini models — handled by OpenAI chains below
  gptMini: [], gptReview: [], gptAdvanced: [],
  gptHyperlinkExtract: [], gptHyperlinkCorrection: [], tts: [],
};

const OPENAI_CHAINS: Record<keyof typeof RESOLVED_MODELS, string[]> = {
  gptMini:                ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptReview:              ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptAdvanced:            ["gpt-4.1", "gpt-4.1-2025-04-14", "gpt-4o"],
  gptHyperlinkExtract:    ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptHyperlinkCorrection: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  tts:                    ["gpt-4o-mini-tts"],
  // Not OpenAI models
  geminiFlash: [], geminiArticle: [], geminiPro: [], geminiCritique: [],
  geminiImage: [], veoVideo: [],
};

// Tiers where no live model = refuse to start
const CRITICAL_TIERS = new Set<keyof typeof RESOLVED_MODELS>([
  "geminiFlash", "geminiArticle", "geminiPro", "gptMini", "gptAdvanced",
]);

// ── API helpers ───────────────────────────────────────────────────────────────

async function listGeminiModels(): Promise<Set<string>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
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
      // Strip "models/" prefix so we compare bare IDs
      ids.add(m.name.replace(/^models\//, ""));
    }
    return ids;
  } catch (err) {
    console.warn(`⚠️ [model-resolver] Gemini ListModels failed: ${(err as Error).message} — skipping Gemini validation`);
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
  tier: keyof typeof RESOLVED_MODELS,
  liveModels: Set<string>,
  chain: string[],
  errors: string[]
): void {
  if (chain.length === 0) return; // tier skipped (handled by another provider)

  const configured = RESOLVED_MODELS[tier];

  // Warn about known upcoming shutdowns even when model is still live
  if (KNOWN_SHUTDOWNS[configured]) {
    console.warn(`⚠️ [model-resolver] ${tier}: "${configured}" has a known shutdown date: ${KNOWN_SHUTDOWNS[configured]}`);
  }

  // If live list is empty (API call failed), trust the configured value
  if (liveModels.size === 0) return;

  if (liveModels.has(configured)) {
    console.log(`   ✅ ${tier}: ${configured}`);
    return;
  }

  // Configured model not found — walk the fallback chain
  const fallback = chain.find((m) => liveModels.has(m));
  if (fallback) {
    console.warn(`   ⚠️  ${tier}: "${configured}" not found in ListModels — falling back to "${fallback}"`);
    (RESOLVED_MODELS as Record<string, string>)[tier] = fallback;
  } else {
    const msg = `${tier}: "${configured}" is gone and no fallback in chain [${chain.join(", ")}] is live`;
    if (CRITICAL_TIERS.has(tier)) {
      errors.push(msg);
    } else {
      console.warn(`   ⚠️  [model-resolver] Non-critical ${msg} — using configured value anyway`);
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Call once at worker startup, before registerWorkers().
 * Updates RESOLVED_MODELS in place. Throws if any critical tier has no live model.
 */
export async function validateAndResolveModels(): Promise<void> {
  console.log("🔍 [model-resolver] Validating AI model IDs against live APIs...");

  // Run both API calls in parallel
  const [geminiLive, openaiLive] = await Promise.all([
    listGeminiModels(),
    listOpenAIModels(),
  ]);

  const errors: string[] = [];

  console.log("   Gemini tiers:");
  for (const tier of Object.keys(GEMINI_CHAINS) as Array<keyof typeof RESOLVED_MODELS>) {
    if (GEMINI_CHAINS[tier].length > 0) {
      resolveOneTier(tier, geminiLive, GEMINI_CHAINS[tier], errors);
    }
  }

  console.log("   OpenAI tiers:");
  for (const tier of Object.keys(OPENAI_CHAINS) as Array<keyof typeof RESOLVED_MODELS>) {
    if (OPENAI_CHAINS[tier].length > 0) {
      resolveOneTier(tier, openaiLive, OPENAI_CHAINS[tier], errors);
    }
  }

  // Veo: not in standard ListModels — log configured value only
  console.log(`   ℹ️  veoVideo: ${RESOLVED_MODELS.veoVideo} (not validated — Veo uses a separate endpoint)`);

  if (errors.length > 0) {
    throw new Error(
      `[model-resolver] Critical model tiers have no live model — refusing to start workers:\n  • ${errors.join("\n  • ")}`
    );
  }

  console.log("✅ [model-resolver] All model tiers resolved. Workers will use:");
  console.log(`   Gemini flash/article : ${RESOLVED_MODELS.geminiFlash}`);
  console.log(`   Gemini pro           : ${RESOLVED_MODELS.geminiPro}`);
  console.log(`   Gemini critique      : ${RESOLVED_MODELS.geminiCritique}`);
  console.log(`   Gemini image         : ${RESOLVED_MODELS.geminiImage}`);
  console.log(`   Veo video            : ${RESOLVED_MODELS.veoVideo}`);
  console.log(`   GPT mini (16 files)  : ${RESOLVED_MODELS.gptMini}`);
  console.log(`   GPT advanced         : ${RESOLVED_MODELS.gptAdvanced}`);
  console.log(`   TTS                  : ${RESOLVED_MODELS.tts}`);
}

/**
 * Call when a model API returns 404/NOT_FOUND mid-flight.
 * Re-runs validation so the next job gets the updated model.
 */
export async function reResolveAfterModelNotFound(
  tier: keyof typeof RESOLVED_MODELS
): Promise<void> {
  console.warn(`🔄 [model-resolver] 404 received for ${tier} — re-running resolver`);
  await validateAndResolveModels();
}
