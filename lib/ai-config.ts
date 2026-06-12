/**
 * AI Model Configuration - AUTO-UPDATING MODELS
 *
 * Models are configured to automatically use the latest stable versions.
 *
 * GEMINI MODELS:
 * - Google's auto-updated aliases (e.g., "gemini-3.5-flash") automatically point
 *   to the latest stable version within that generation.
 * - gemini-2.0-flash and gemini-2.5-flash are superseded. All workloads use gemini-3.5-flash.
 *
 * OPENAI MODELS:
 * - "gpt-4.5-mini" is the latest cost-effective mini model (replaces gpt-4o-mini)
 * - "gpt-4.1" is the latest standard model (replaces gpt-4o)
 *
 * To pin to a specific version (disable auto-updates), use dated versions:
 * - Gemini: "gemini-3.5-flash-001" (specific snapshot)
 * - OpenAI: "gpt-4.1-2025-04-14" (specific snapshot)
 */

// Gemini Models - gemini-3.5-flash/pro are the latest stable aliases
export const GEMINI_ARTICLE_MODEL = process.env.GEMINI_ARTICLE_MODEL || "gemini-3.5-flash";
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-3.5-flash";
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-3.5-pro";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.5-flash-image";
export const GEMINI_EXPERIMENTAL_MODEL = process.env.GEMINI_EXPERIMENTAL_MODEL || "gemini-3.5-pro";

// OpenAI Models
// gpt-4.5-mini: Latest mini model — fast, cost-effective, used for review / chat tasks
// gpt-4.1:      Latest standard model — used for advanced/enhancement tasks
export const GPT_ENHANCEMENT_MODEL = process.env.GPT_ENHANCEMENT_MODEL || "gpt-4.5-mini";
export const GPT_REVIEW_MODEL = process.env.GPT_REVIEW_MODEL || "gpt-4.5-mini";
export const GPT_ADVANCED_MODEL = process.env.GPT_ADVANCED_MODEL || "gpt-4.1";

// Keyword hyperlink pipeline models
// Extraction → gpt-4.1-nano: simple JSON extraction; 92% cheaper than gpt-4.1
// Correction → gpt-4.1: must reconstruct 35 000–40 000 chars of HTML reliably
export const GPT_HYPERLINK_EXTRACT_MODEL = process.env.GPT_HYPERLINK_EXTRACT_MODEL || "gpt-4.1-nano";
export const GPT_HYPERLINK_CORRECTION_MODEL = process.env.GPT_HYPERLINK_CORRECTION_MODEL || "gpt-4.1";

// Gemini model for article critique / refine pass.
// Flash-Lite is 80% cheaper than Flash; override to gemini-2.5-flash for higher quality.
export const GEMINI_CRITIQUE_MODEL = process.env.GEMINI_CRITIQUE_MODEL || "gemini-3.5-flash-lite";

// Veo Video Generation
export const VEO_VIDEO_MODEL = process.env.VEO_VIDEO_MODEL || "veo-2.0-generate-001";

// TTS Configuration
// gpt-4o-mini-tts: supports emotional steering via instructions parameter
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
