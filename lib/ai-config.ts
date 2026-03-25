/**
 * AI Model Configuration - AUTO-UPDATING MODELS
 * 
 * Models are configured to automatically use the latest stable versions.
 * 
 * GEMINI MODELS:
 * - Google's auto-updated aliases (e.g., "gemini-2.5-flash") automatically point
 *   to the latest stable version within that generation.
 * - When Google releases updates, your app automatically uses them.
 * - NOTE: gemini-2.0-flash and gemini-2.0-flash-lite are deprecated and will be
 *   discontinued June 1, 2026. All workloads now use gemini-2.5-flash.
 * 
 * OPENAI MODELS:
 * - "chatgpt-4o-latest" automatically updates to the latest ChatGPT version
 * - "gpt-4o-mini" auto-updates within the mini tier
 * - Note: chatgpt-4o-latest costs 2x more but stays current automatically
 * 
 * To pin to a specific version (disable auto-updates), use dated versions:
 * - Gemini: "gemini-2.5-flash-001" (specific snapshot)
 * - OpenAI: "gpt-4o-2024-11-20" (specific snapshot)
 */

// Gemini Models - Using auto-updated aliases (latest stable within generation)
export const GEMINI_ARTICLE_MODEL = process.env.GEMINI_ARTICLE_MODEL || "gemini-2.5-flash";
export const GEMINI_FLASH_MODEL = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
export const GEMINI_PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-2.5-pro";
export const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
export const GEMINI_EXPERIMENTAL_MODEL = process.env.GEMINI_EXPERIMENTAL_MODEL || "gemini-2.5-flash";

// OpenAI Models - Using auto-updating aliases
// chatgpt-4o-latest: Auto-updates to latest ChatGPT improvements (2x cost but always current)
// gpt-4o-mini: Auto-updates within the mini tier (cost-effective)
export const GPT_ENHANCEMENT_MODEL = process.env.GPT_ENHANCEMENT_MODEL || "gpt-4o-mini";
export const GPT_REVIEW_MODEL = process.env.GPT_REVIEW_MODEL || "gpt-4o-mini";
export const GPT_ADVANCED_MODEL = process.env.GPT_ADVANCED_MODEL || "chatgpt-4o-latest";

// Veo Video Generation - Using Veo 2 for cost-efficient cinematic AI videos
// veo-2-generate-001: High-quality clips, no native audio (we use OpenAI TTS instead)
// veo-3.1-generate-preview: Premium model with native audio — billed separately, not used
// Override via VEO_VIDEO_MODEL env var to switch models without a redeploy
export const VEO_VIDEO_MODEL = process.env.VEO_VIDEO_MODEL || "veo-2-generate-001";

// TTS Configuration
// gpt-4o-mini-tts: Supports emotional steering via instructions parameter
// tts-1-hd: High-quality studio-grade audio (48kHz)
// tts-1: Fast, lower latency (good for real-time)
export const TTS_MODEL = process.env.TTS_MODEL || "gpt-4o-mini-tts";
export const TTS_VOICE = process.env.TTS_VOICE || "coral"; // Warm, friendly voice

// Voice options: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer
// - coral: Warm, friendly (great for educational content)
// - fable: Expressive, storytelling
// - nova: Energetic, youthful
// - onyx: Deep, authoritative

// Helper to log current configuration
export function logAIConfig() {
  console.log("🤖 AI Model Configuration:");
  console.log(`   Gemini Article: ${GEMINI_ARTICLE_MODEL}`);
  console.log(`   Gemini Flash: ${GEMINI_FLASH_MODEL}`);
  console.log(`   Gemini Pro: ${GEMINI_PRO_MODEL}`);
  console.log(`   Gemini Image: ${GEMINI_IMAGE_MODEL}`);
  console.log(`   Veo Video: ${VEO_VIDEO_MODEL}`);
  console.log(`   GPT Enhancement: ${GPT_ENHANCEMENT_MODEL}`);
  console.log(`   GPT Review: ${GPT_REVIEW_MODEL}`);
  console.log(`   GPT Advanced: ${GPT_ADVANCED_MODEL}`);
  console.log(`   TTS: ${TTS_MODEL} (voice: ${TTS_VOICE})`);
}

// Export all config as object for easy access
export const AI_CONFIG = {
  gemini: {
    article: GEMINI_ARTICLE_MODEL,
    flash: GEMINI_FLASH_MODEL,
    pro: GEMINI_PRO_MODEL,
    image: GEMINI_IMAGE_MODEL,
    experimental: GEMINI_EXPERIMENTAL_MODEL,
  },
  veo: {
    video: VEO_VIDEO_MODEL,
  },
  openai: {
    enhancement: GPT_ENHANCEMENT_MODEL,
    review: GPT_REVIEW_MODEL,
    advanced: GPT_ADVANCED_MODEL,
  },
  tts: {
    model: TTS_MODEL,
    voice: TTS_VOICE,
  },
};
