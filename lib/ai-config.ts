/**
 * AI Model Configuration
 *
 * All model IDs verified against the live APIs (August 2026).
 * Override any via environment variable to pin a specific version.
 *
 * Gemini ground truth (from ListModels against this key, 2026-08):
 *   gemini-3.5-flash        — live, current flash tier
 *   gemini-3.1-pro-preview  — live, current pro tier (gemini-2.5-pro shuts down 2026-10-16)
 *   gemini-2.5-flash-image  — live, native image-output model
 *   gemini-2.5-flash-lite   — live, fast/cheap critique pass
 *   veo-3.1-fast-generate-preview — live (veo-2.0-generate-001 is gone)
 *
 * OpenAI ground truth (from /v1/models against this key, 2026-08):
 *   gpt-4.1-mini  — current cost-effective tier (replaces gpt-4o-mini)
 *   gpt-4.1       — current standard tier (replaces gpt-4o)
 *   gpt-4o-mini-tts — TTS model (still live)
 */

// ── Gemini text models ────────────────────────────────────────────────────────
export const GEMINI_ARTICLE_MODEL      = process.env.GEMINI_ARTICLE_MODEL      || "gemini-3.5-flash";
export const GEMINI_FLASH_MODEL        = process.env.GEMINI_FLASH_MODEL        || "gemini-3.5-flash";
export const GEMINI_PRO_MODEL          = process.env.GEMINI_PRO_MODEL          || "gemini-3.1-pro-preview";
export const GEMINI_EXPERIMENTAL_MODEL = process.env.GEMINI_EXPERIMENTAL_MODEL || "gemini-3.1-pro-preview";
// Fast critique pass — lite is sufficient; override to pro for higher quality
export const GEMINI_CRITIQUE_MODEL     = process.env.GEMINI_CRITIQUE_MODEL     || "gemini-2.5-flash-lite";

// ── Gemini image generation ───────────────────────────────────────────────────
// gemini-2.5-flash-image: supports generateContent with responseModalities ['IMAGE']
// gemini-2.0-flash-exp was shut down 2026-06-01 — do not use.
export const GEMINI_IMAGE_MODEL        = process.env.GEMINI_IMAGE_MODEL        || "gemini-2.5-flash-image";

// ── Veo video generation ──────────────────────────────────────────────────────
// veo-2.0-generate-001 is gone. veo-3.1-fast for cost efficiency;
// override to veo-3.1-generate-preview for higher quality.
export const VEO_VIDEO_MODEL           = process.env.VEO_VIDEO_MODEL           || "veo-3.1-fast-generate-preview";

// ── OpenAI models ─────────────────────────────────────────────────────────────
// gpt-4.1-mini: current cost-effective tier (verified in /v1/models 2026-08)
// gpt-4.1:      current standard tier
export const GPT_ENHANCEMENT_MODEL          = process.env.GPT_ENHANCEMENT_MODEL          || "gpt-4.1-mini";
export const GPT_REVIEW_MODEL               = process.env.GPT_REVIEW_MODEL               || "gpt-4.1-mini";
export const GPT_ADVANCED_MODEL             = process.env.GPT_ADVANCED_MODEL             || "gpt-4.1";
export const GPT_HYPERLINK_EXTRACT_MODEL    = process.env.GPT_HYPERLINK_EXTRACT_MODEL    || "gpt-4.1-mini";
export const GPT_HYPERLINK_CORRECTION_MODEL = process.env.GPT_HYPERLINK_CORRECTION_MODEL || "gpt-4.1-mini";

// ── TTS ───────────────────────────────────────────────────────────────────────
export const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
export const TTS_VOICE = process.env.TTS_VOICE || "coral";
// Voices: alloy, ash, coral (warm/friendly), echo, fable (storytelling),
//         nova (energetic), onyx (authoritative), sage, shimmer

export function logAIConfig() {
  console.log("🤖 AI Model Configuration:");
  console.log(`   Gemini Article:  ${GEMINI_ARTICLE_MODEL}`);
  console.log(`   Gemini Flash:    ${GEMINI_FLASH_MODEL}`);
  console.log(`   Gemini Pro:      ${GEMINI_PRO_MODEL}`);
  console.log(`   Gemini Exp:      ${GEMINI_EXPERIMENTAL_MODEL}`);
  console.log(`   Gemini Image:    ${GEMINI_IMAGE_MODEL}`);
  console.log(`   Gemini Critique: ${GEMINI_CRITIQUE_MODEL}`);
  console.log(`   Veo Video:       ${VEO_VIDEO_MODEL}`);
  console.log(`   GPT Enhancement: ${GPT_ENHANCEMENT_MODEL}`);
  console.log(`   GPT Review:      ${GPT_REVIEW_MODEL}`);
  console.log(`   GPT Advanced:    ${GPT_ADVANCED_MODEL}`);
  console.log(`   TTS:             ${TTS_MODEL} (voice: ${TTS_VOICE})`);
  console.log(`   Gemini API key:  ${process.env.GEMINI_API_KEY ? "✅ set" : "❌ MISSING"}`);
  console.log(`   OpenAI API key:  ${process.env.OPENAI_API_KEY ? "✅ set" : "❌ MISSING"}`);
}

export const AI_CONFIG = {
  gemini: {
    article:      GEMINI_ARTICLE_MODEL,
    flash:        GEMINI_FLASH_MODEL,
    pro:          GEMINI_PRO_MODEL,
    image:        GEMINI_IMAGE_MODEL,
    experimental: GEMINI_EXPERIMENTAL_MODEL,
    critique:     GEMINI_CRITIQUE_MODEL,
  },
  veo: {
    video: VEO_VIDEO_MODEL,
  },
  openai: {
    enhancement:         GPT_ENHANCEMENT_MODEL,
    review:              GPT_REVIEW_MODEL,
    advanced:            GPT_ADVANCED_MODEL,
    hyperlinkExtract:    GPT_HYPERLINK_EXTRACT_MODEL,
    hyperlinkCorrection: GPT_HYPERLINK_CORRECTION_MODEL,
  },
  tts: {
    model: TTS_MODEL,
    voice: TTS_VOICE,
  },
};
