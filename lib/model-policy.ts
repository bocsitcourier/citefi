/** Pure selection policy. Discovery is not proof of compatibility or pricing. */
export type ModelTier =
  | "geminiFlash" | "geminiArticle" | "geminiPro" | "geminiCritique"
  | "geminiImage" | "veoVideo" | "gptMini" | "gptReview" | "gptAdvanced"
  | "gptHyperlinkExtract" | "gptHyperlinkCorrection" | "tts";

export interface CatalogModel { id: string; methods?: string[] }
export interface LockedModelRate {
  input: number;
  output: number;
  unit: number;
  version: string;
  dimensions?: Record<string, { input: number; output: number; unit: number }>;
}
export interface ApprovedModel {
  id: string;
  priority: number;
  /** Identifies the supported request contract, not a provider marketing name. */
  contract: string;
}
export interface ModelDecision {
  tier: ModelTier;
  selected: string | null;
  reason: "pinned" | "automatic" | "fallback" | "unavailable";
  blocked: Array<{ id: string; reason: string }>;
}

export const MODEL_CONTRACTS: Record<ModelTier, string> = {
  geminiFlash: "gemini-text", geminiArticle: "gemini-text", geminiPro: "gemini-text",
  geminiCritique: "gemini-text", geminiImage: "gemini-image", veoVideo: "veo-video",
  gptMini: "openai-chat", gptReview: "openai-chat", gptAdvanced: "openai-chat",
  gptHyperlinkExtract: "openai-chat", gptHyperlinkCorrection: "openai-chat",
  tts: "openai-speech",
};
export function modelProvider(tier: ModelTier): "gemini" | "openai" {
  return tier.startsWith("gemini") || tier === "veoVideo" ? "gemini" : "openai";
}
function validRate(rate: LockedModelRate | undefined): rate is LockedModelRate {
  return !!rate && !!rate.version &&
    [rate.input, rate.output, rate.unit].every(n => Number.isSafeInteger(n) && n >= 0) &&
    Number.isSafeInteger(rate.input + rate.output + rate.unit) &&
    (rate.input + rate.output + rate.unit > 0);
}

/** Pins never silently fall back. Promotions cannot increase any billing dimension. */
export function selectTierModel(input: {
  tier: ModelTier;
  configured: string;
  pinned: boolean;
  catalog: CatalogModel[];
  approved: ApprovedModel[];
  rates: Record<string, LockedModelRate>;
}): ModelDecision {
  const { tier, configured, pinned, catalog, approved, rates } = input;
  const live = new Map(catalog.map(m => [m.id, m]));
  const blocked: ModelDecision["blocked"] = [];
  const configuredLive = live.has(configured);
  const expected = MODEL_CONTRACTS[tier];
  if (pinned) {
    const approvedPin = approved.some(candidate => candidate.id === configured && candidate.contract === expected);
    const operationSupported = modelProvider(tier) !== "gemini" || live.get(configured)?.methods?.includes(
      tier === "veoVideo" ? "predictLongRunning" : "generateContent");
    const accepted = configuredLive && approvedPin && operationSupported;
    return {
      tier, selected: accepted ? configured : null,
      reason: accepted ? "pinned" : "unavailable",
      blocked: accepted ? [] : [{ id: configured, reason:
        "Pinned model unavailable or contract unapproved; pin was not overridden" }],
    };
  }
  const eligible = approved.filter(candidate => {
    const metadata = live.get(candidate.id);
    if (!metadata) return false;
    let reason = "";
    if (!Number.isSafeInteger(candidate.priority)) reason = "Invalid approved priority";
    else if (candidate.contract !== expected) reason = "Request contract not approved for this tier";
    else if (modelProvider(tier) === "gemini" && !metadata.methods?.includes(
      tier === "veoVideo" ? "predictLongRunning" : "generateContent"
    )) reason = "Required provider operation not listed";
    // Baseline selection is existing behavior, not an automatic promotion.
    else if (candidate.id !== configured) {
      const baseline = rates[configured], next = rates[candidate.id];
      if (!validRate(baseline) || !validRate(next)) reason = "Missing locked pricing evidence";
      else if (tier === "geminiImage" && ["images", "tokens"].some(unit =>
        !baseline.dimensions?.[unit] || !next.dimensions?.[unit]))
        reason = "Missing modality-specific locked pricing evidence";
      else if (baseline.dimensions && Object.entries(baseline.dimensions).some(([unit, ceiling]) => {
        const rate = next.dimensions?.[unit];
        return !rate || ![rate.input, rate.output, rate.unit].every(n => Number.isSafeInteger(n) && n >= 0) ||
          rate.input > ceiling.input || rate.output > ceiling.output || rate.unit > ceiling.unit;
      })) reason = "Exceeds a modality-specific cost ceiling";
      else if (next.input > baseline.input || next.output > baseline.output || next.unit > baseline.unit)
        reason = "Exceeds configured-model cost ceiling";
    }
    if (reason) blocked.push({ id: candidate.id, reason });
    return !reason;
  }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const winner = eligible[0];
  return {
    tier, selected: winner?.id ?? null,
    reason: !winner ? "unavailable" : winner.id === configured ? "fallback" : "automatic",
    blocked,
  };
}
