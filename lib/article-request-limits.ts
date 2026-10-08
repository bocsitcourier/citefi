/** Opt-in bounded article requests; ordinary production calls keep their defaults. */
import type { GenerateContentConfig } from "@google/genai";
export interface ArticleRequestLimits {
  maxOutputTokens: number;
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
}

// The installed SDK's types predate thinkingLevel. Its REST serializer retains
// the field (covered offline); this narrow extension avoids a package upgrade.
export function articleGenerationLimits(model: string, limits?: ArticleRequestLimits): {
  maxOutputTokens: number;
  thinkingConfig?: NonNullable<GenerateContentConfig["thinkingConfig"]> & {
    thinkingLevel: NonNullable<ArticleRequestLimits["thinkingLevel"]>;
  };
} {
  if (limits && (!Number.isInteger(limits.maxOutputTokens) ||
      limits.maxOutputTokens < 1 || limits.maxOutputTokens > 65536)) {
    throw new Error("Invalid article output token limit");
  }
  if (limits?.thinkingLevel !== undefined &&
      (model !== "gemini-3.5-flash" ||
       !["MINIMAL", "LOW", "MEDIUM", "HIGH"].includes(limits.thinkingLevel))) {
    throw new Error("Unsupported article thinking configuration");
  }
  return {
    // This total allowance includes reasoning, not just visible candidate text.
    maxOutputTokens: limits?.maxOutputTokens ?? 65536,
    ...(limits?.thinkingLevel ? { thinkingConfig: { thinkingLevel: limits.thinkingLevel } } : {}),
  };
}
