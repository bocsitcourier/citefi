/**
 * AI Model Configuration - AUTO-UPDATING MODELS
 *
 * All model aliases automatically resolve to the latest stable version from
 * each provider. When a provider promotes a new stable release, this app
 * picks it up with zero code changes.
 *
 * To pin to a specific snapshot (disable auto-updates), override via env var
 * with a dated version string:
 *   GEMINI_ARTICLE_MODEL=gemini-3.5-flash-001
 *   GPT_ENHANCEMENT_MODEL=gpt-5.4-mini-2025-04-14
 */

// Google AI Models — stable aliases auto-point to latest release in each tier
export const GEMINI_ARTICLE_MODEL = process.env.GEMINI_ARTICLE_MODEL || "gemini-3.5-flash";
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-3.5-flash";
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-3.5-pro";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.5-flash-image";
export const GEMINI_EXPERIMENTAL_MODEL = process.env.GEMINI_EXPERIMENTAL_MODEL || "gemini-3.5-pro";

// Google AI — fast/cheap critique pass (override to pro for higher quality)
export const GEMINI_CRITIQUE_MODEL = process.env.GEMINI_CRITIQUE_MODEL || "gemini-3.5-flash-lite";

// OpenAI Models — gpt-5.4-mini is the current latest cost-effective model
export const GPT_ENHANCEMENT_MODEL = process.env.GPT_ENHANCEMENT_MODEL || "gpt-5.4-mini";
export const GPT_REVIEW_MODEL = process.env.GPT_REVIEW_MODEL || "gpt-5.4-mini";
export const GPT_ADVANCED_MODEL = process.env.GPT_ADVANCED_MODEL || "gpt-5.4-mini";

// Hyperlink pipeline — same model handles both extraction and HTML correction
export const GPT_HYPERLINK_EXTRACT_MODEL = process.env.GPT_HYPERLINK_EXTRACT_MODEL || "gpt-5.4-mini";
export const GPT_HYPERLINK_CORRECTION_MODEL = process.env.GPT_HYPERLINK_CORRECTION_MODEL || "gpt-5.4-mini";

// Veo Video Generation
export const VEO_VIDEO_MODEL = process.env.VEO_VIDEO_MODEL || "veo-2.0-generate-001";

// TTS — supports emotional steering via instructions parameter
export const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
export const TTS_VOICE = process.env.TTS_VOICE || "coral";

// Voice options: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer
// - coral: Warm, friendly (great for educational content)
// - fable: Expressive, storytelling
// - nova: Energetic, youthful
// - onyx: Deep, authoritative

export function logAIConfig() {
  console.log("🤖 AI Model Configuration:");
  console.log(`   Gemini Article: ${GEMINI_ARTICLE_MODEL}`);
  console.log(`   Gemini Flash: ${GEMINI_FLASH_MODEL}`);
  console.log(`   Gemini Pro: ${GEMINI_PRO_MODEL}`);
  console.log(`   Gemini Image: ${GEMINI_IMAGE_MODEL}`);
  console.log(`   Veo Video: ${VEO_VIDEO_MODEL}`);
  console.log(`   Gemini Critique: ${GEMINI_CRITIQUE_MODEL}`);
  console.log(`   GPT Enhancement: ${GPT_ENHANCEMENT_MODEL}`);
  console.log(`   GPT Review: ${GPT_REVIEW_MODEL}`);
  console.log(`   GPT Advanced: ${GPT_ADVANCED_MODEL}`);
  console.log(`   GPT Hyperlink Extract: ${GPT_HYPERLINK_EXTRACT_MODEL}`);
  console.log(`   GPT Hyperlink Correction: ${GPT_HYPERLINK_CORRECTION_MODEL}`);
  console.log(`   TTS: ${TTS_MODEL} (voice: ${TTS_VOICE})`);
}

export const AI_CONFIG = {
  gemini: {
    article: GEMINI_ARTICLE_MODEL,
    flash: GEMINI_FLASH_MODEL,
    pro: GEMINI_PRO_MODEL,
    image: GEMINI_IMAGE_MODEL,
    experimental: GEMINI_EXPERIMENTAL_MODEL,
    critique: GEMINI_CRITIQUE_MODEL,
  },
  veo: {
    video: VEO_VIDEO_MODEL,
  },
  openai: {
    enhancement: GPT_ENHANCEMENT_MODEL,
    review: GPT_REVIEW_MODEL,
    advanced: GPT_ADVANCED_MODEL,
    hyperlinkExtract: GPT_HYPERLINK_EXTRACT_MODEL,
    hyperlinkCorrection: GPT_HYPERLINK_CORRECTION_MODEL,
  },
  tts: {
    model: TTS_MODEL,
    voice: TTS_VOICE,
  },
};
