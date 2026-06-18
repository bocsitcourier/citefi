/**
 * GenerationOrchestrator
 * ======================
 * Feature-flagged wrapper around OptimizedContentGenerator.reviewAndRepairContent().
 *
 * Responsibilities:
 *   1. Runs the critic-in-the-loop repair cycle (bounded, cost-controlled)
 *   2. Returns the enhanced content for the next pipeline stage
 *
 * Pattern attribution (patternsUsedJson → contentPerformanceMetrics) is
 * handled downstream by recordContentGenerated() / learningService.
 * The orchestrator owns ONLY the critic loop and the content return.
 *
 * Feature flags:
 *   DISABLE_CRITIC_LOOP=true  — bypass the critic entirely (kill switch).
 *   Callers in worker.ts / social-worker.ts guard the block with the same
 *   flag so pattern fetching is also skipped when the loop is off.
 */

import { optimizedContentGenerator } from "./optimized-content-generator";
import type { RepairResult } from "./optimized-content-generator";

export type ContentKind = "article" | "social";

export interface OrchestratorInput {
  teamId: number;
  /** Drizzle content-type token ("ARTICLE", "SOCIAL", etc.) */
  contentType: string;
  /**
   * Row id for the critic loop.
   * For articles: articleId.
   * For social: socialPostId (NOT variant.id — content_review_service stores
   * this as socialPostId when contentType === SOCIAL).
   */
  contentId: number;
  /** Raw generated text entering the critic loop */
  content: string;
  /** Pattern IDs from getPromptEnhancement() — used for Wilson attribution */
  patternsUsed: number[];
  brief?: {
    topic?: string;
    location?: string;
    targetWords?: number;
    keyword?: string;
  };
  kind: ContentKind;
}

export interface OrchestratorResult extends RepairResult {
  /** Pattern IDs that were fed into the critic loop */
  patternsInjected: number[];
  /** false when DISABLE_CRITIC_LOOP killed the path */
  orchestrated: boolean;
}

export async function runGenerationOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const disabled = process.env.DISABLE_CRITIC_LOOP === "true";

  if (disabled) {
    return {
      content: input.content,
      repairs: 0,
      qualityScore: 0,
      status: "ready",
      review: null as any,
      patternsInjected: input.patternsUsed,
      orchestrated: false,
    };
  }

  let repairResult: RepairResult;
  try {
    repairResult = await optimizedContentGenerator.reviewAndRepairContent(
      input.teamId,
      input.contentType,
      input.contentId,
      input.content,
      input.patternsUsed,
      input.brief ?? {}
    );
  } catch (err) {
    console.warn(
      `[orchestrator] reviewAndRepairContent failed — passthrough for ${input.contentType} ${input.contentId}:`,
      (err as Error).message
    );
    return {
      content: input.content,
      repairs: 0,
      qualityScore: 0,
      status: "ready",
      review: null as any,
      patternsInjected: input.patternsUsed,
      orchestrated: false,
    };
  }

  return {
    ...repairResult,
    patternsInjected: input.patternsUsed,
    orchestrated: true,
  };
}
