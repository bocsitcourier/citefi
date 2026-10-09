import { MODEL_CONTRACTS, type ApprovedModel, type ModelTier } from "./model-policy";

/**
 * Release-controlled capability approvals. Catalog IDs outside this registry
 * are discovered and reported, but must not inherit compatibility from a name.
 * Add candidates only with SDK contract tests and authoritative locked rates.
 * Preference is explicit: aliases/snapshots and preview/stable cannot be ranked
 * safely by string sorting or catalog creation timestamps.
 */
const IDS: Record<ModelTier, string[]> = {
  geminiFlash: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiArticle: ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-preview-04-17"],
  geminiPro: ["gemini-3.1-pro-preview", "gemini-2.5-pro"],
  geminiCritique: ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
  geminiImage: ["gemini-3.1-flash-image", "gemini-2.5-flash-image"],
  veoVideo: ["veo-3.1-fast-generate-preview"],
  gptMini: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptReview: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptAdvanced: ["gpt-4.1", "gpt-4.1-2025-04-14", "gpt-4o"],
  gptHyperlinkExtract: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  gptHyperlinkCorrection: ["gpt-4.1-mini", "gpt-4.1-mini-2025-04-14", "gpt-4o-mini"],
  tts: ["gpt-4o-mini-tts"],
};
export function approvedModels(tier: ModelTier): ApprovedModel[] {
  return IDS[tier].map((id, index) => ({
    id, priority: IDS[tier].length - index, contract: MODEL_CONTRACTS[tier],
  }));
}
