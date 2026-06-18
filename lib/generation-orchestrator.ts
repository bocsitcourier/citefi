/**
 * GenerationOrchestrator
 * ======================
 * Feature-flagged wrapper around OptimizedContentGenerator.reviewAndRepairContent().
 *
 * Responsibilities:
 *   1. Runs the critic-in-the-loop repair cycle (bounded, cost-controlled)
 *   2. Forces a final GPT-4o-mini judge pass for ARTICLE/SOCIAL even when
 *      content passes the fast reviewer without any repairs
 *   3. Injects brand policy context from ClientBrandProfile into repair prompts
 *   4. Returns the enhanced content + quality score for downstream recording
 *
 * Pattern attribution (patternsUsedJson → contentPerformanceMetrics) is
 * handled downstream by recordContentGenerated() / learningService.
 *
 * Feature flags:
 *   DISABLE_CRITIC_LOOP=true              — bypass the critic entirely (global kill switch)
 *   ORCHESTRATOR_MODE_{CONTENTTYPE}       — per-type mode: active (default) | shadow | off
 *     active: run repairs normally (default)
 *     shadow: run critic internally for observability; return ORIGINAL content unchanged
 *             (safe validation window before going live on a content type)
 *     off:    passthrough for this content type only
 *
 * Observability events (grep-able console tags):
 *   [ORCHESTRATOR_WIRED]       — emitted at the start of every qualifying orchestrator call
 *   [BRAND_POLICY_INJECTED]    — brand context successfully fetched; will be passed to repairs
 *   [BRAND_POLICY_MISSING]     — brand context fetch returned empty; repairs run without it
 *   [ORCHESTRATOR_SHADOW]      — shadow diff: original vs what would have been repaired
 */

import { optimizedContentGenerator } from "./optimized-content-generator";
import type { RepairResult } from "./optimized-content-generator";
import { getClientBrandContext } from "./client-brand-profile-service";
import { ContentType } from "../shared/schema";

export type ContentKind = "article" | "social" | "podcast" | "script";

export interface OrchestratorInput {
  teamId: number;
  /** Drizzle content-type token ("ARTICLE", "SOCIAL", "PODCAST", "VIDEO", etc.) */
  contentType: string;
  /**
   * Row id for the critic loop.
   * For articles: articleId.
   * For social: socialPostId (NOT variant.id).
   * For podcasts: articleId (podcasts are tied to articles).
   * For videos: videoIdeaId.
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
  /**
   * Force a final GPT-4o-mini judge pass even when content has zero defects.
   * Auto-defaults to true for ARTICLE and SOCIAL (quality scoring matters most).
   * Explicitly set false to skip for PODCAST / VIDEO (lower-value text artifacts).
   */
  requireJudge?: boolean;
}

export interface OrchestratorResult extends RepairResult {
  /** Pattern IDs that were fed into the critic loop */
  patternsInjected: number[];
  /**
   * false when DISABLE_CRITIC_LOOP, ORCHESTRATOR_MODE_*=off, or shadow mode
   * (shadow runs the critic internally but does not alter production output)
   */
  orchestrated: boolean;
  /**
   * Decision arm ID for Bayesian A/B attribution.
   * Always undefined until sampleArm() is implemented.
   * Workers must pass this through to recordContentGenerated(opts.armId)
   * so arm_id is populated in content_performance_metrics once ready.
   */
  armId?: number;
}

export async function runGenerationOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const globalDisabled = process.env.DISABLE_CRITIC_LOOP === "true";
  if (globalDisabled) {
    return passthroughResult(input);
  }

  const modeKey = `ORCHESTRATOR_MODE_${input.contentType.toUpperCase()}`;
  const mode = (process.env[modeKey] ?? "active") as "active" | "shadow" | "off";
  if (mode === "off") {
    return passthroughResult(input);
  }

  const requireJudge =
    input.requireJudge ??
    (input.contentType === ContentType.ARTICLE ||
      input.contentType === ContentType.SOCIAL);

  // Observability: confirm this content type is wired through the orchestrator
  console.log(
    `[ORCHESTRATOR_WIRED] type=${input.contentType} id=${input.contentId} ` +
      `mode=${mode} requireJudge=${requireJudge} patterns=${input.patternsUsed.length}`
  );

  // Fetch brand policy context — non-blocking, missing context degrades gracefully
  let brandContext: string | undefined;
  try {
    const ctx = await getClientBrandContext(input.teamId);
    if (ctx) brandContext = ctx;
  } catch {
    // Non-fatal — brand context injection is best-effort
  }
  console.log(
    `[BRAND_POLICY_${brandContext ? "INJECTED" : "MISSING"}] ` +
      `type=${input.contentType} id=${input.contentId}`
  );

  let repairResult: RepairResult;
  try {
    repairResult = await optimizedContentGenerator.reviewAndRepairContent(
      input.teamId,
      input.contentType,
      input.contentId,
      input.content,
      input.patternsUsed,
      input.brief ?? {},
      { requireJudge, brandContext }
    );
  } catch (err) {
    console.warn(
      `[orchestrator] reviewAndRepairContent failed — passthrough for ${input.contentType} ${input.contentId}:`,
      (err as Error).message
    );
    return passthroughResult(input);
  }

  // Shadow mode: run critic internally for observability but return ORIGINAL content unchanged.
  // Production output is never altered in shadow mode — this is a safe validation window.
  if (mode === "shadow") {
    const origExcerpt = input.content.slice(0, 250).replace(/\s+/g, " ");
    const repairedExcerpt = repairResult.content.slice(0, 250).replace(/\s+/g, " ");
    console.log(
      `[ORCHESTRATOR_SHADOW] type=${input.contentType} id=${input.contentId} ` +
        `repairs=${repairResult.repairs} quality=${repairResult.qualityScore} ` +
        `status=${repairResult.status} requireJudge=${requireJudge} ` +
        `patterns=[${input.patternsUsed.join(",")}]\n` +
        `  ORIG:     ${origExcerpt}\n` +
        `  WOULD_BE: ${repairedExcerpt}`
    );
    // orchestrated=false signals that production output was NOT governed by the orchestrator
    return {
      content: input.content,
      repairs: repairResult.repairs,
      qualityScore: repairResult.qualityScore,
      status: repairResult.status,
      review: repairResult.review,
      patternsInjected: input.patternsUsed,
      orchestrated: false,
      armId: undefined,
    };
  }

  if (repairResult.repairs > 0 || requireJudge) {
    const brandLabel = brandContext ? " +brandPolicy" : "";
    console.log(
      `[orchestrator] ${input.contentType} ${input.contentId}: ` +
        `repairs=${repairResult.repairs} quality=${repairResult.qualityScore} ` +
        `requireJudge=${requireJudge}${brandLabel}`
    );
  }

  return {
    ...repairResult,
    patternsInjected: input.patternsUsed,
    orchestrated: true,
    // armId: populated by sampleArm() once Bayesian A/B routing is implemented
    armId: undefined,
  };
}

function passthroughResult(input: OrchestratorInput): OrchestratorResult {
  return {
    content: input.content,
    repairs: 0,
    qualityScore: 0,
    status: "ready",
    review: null as any,
    patternsInjected: input.patternsUsed,
    orchestrated: false,
    armId: undefined,
  };
}
