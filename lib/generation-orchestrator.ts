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
 *   4. Assigns a Bayesian decision arm via Thompson Sampling (arm_id persisted to metrics)
 *   5. Returns the enhanced content + quality score + armId for downstream recording
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
 * Arm assignment is independent of critic enable/disable — sampleArm() always runs.
 *
 * Observability events (grep-able console tags):
 *   [ORCHESTRATOR_WIRED]       — emitted at the start of every qualifying orchestrator call
 *   [ARM_ASSIGNED]             — a Bayesian arm was selected via Thompson Sampling
 *   [BRAND_POLICY_INJECTED]    — brand context successfully fetched; will be passed to repairs
 *   [BRAND_POLICY_MISSING]     — brand context fetch returned empty; repairs run without it
 *   [ORCHESTRATOR_SHADOW]      — shadow diff: original vs what would have been repaired
 */

import { optimizedContentGenerator } from "./optimized-content-generator";
import type { RepairResult } from "./optimized-content-generator";
import { getClientBrandContext } from "./client-brand-profile-service";
import { db } from "./db";
import { ContentType, decisionArms } from "../shared/schema";
import { eq, and } from "drizzle-orm";

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
   * Decision arm ID selected via Thompson Sampling from active decisionArms.
   * undefined when no experiment is running for this team+contentType.
   * Must be threaded through to recordContentGenerated(opts.armId) by all callers
   * so arm_id is persisted in content_performance_metrics.
   */
  armId?: number;
}

// ---------------------------------------------------------------------------
// Thompson Sampling — Beta distribution sampler
// ---------------------------------------------------------------------------

/** Minimal Beta(a, b) sampler using Joehnk's method (small params) or normal
 *  approximation (large params). Used for Thompson Sampling arm selection. */
function betaSample(alpha: number, beta: number): number {
  const a = Math.max(alpha, 0.01);
  const b = Math.max(beta, 0.01);
  if (a + b > 40) {
    // Normal approximation — accurate for large a+b
    const mu = a / (a + b);
    const v = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
    return Math.max(1e-6, Math.min(1 - 1e-6, mu + Math.sqrt(v) * z));
  }
  // Joehnk's method — exact for all a, b > 0
  let x: number, y: number;
  do {
    x = Math.pow(Math.random(), 1 / a);
    y = Math.pow(Math.random(), 1 / b);
  } while (x + y > 1);
  return x / (x + y);
}

/**
 * Decision policy hook: select a decision arm for this generation via Thompson Sampling.
 * Queries active arms for the team+contentType, samples each Beta(posteriorAlpha, posteriorBeta)
 * posterior, and returns the arm with the highest sample.
 * Returns undefined when no active experiment exists for this team+contentType.
 */
async function sampleArm(teamId: number, contentType: string): Promise<number | undefined> {
  try {
    const arms = await db
      .select({
        id: decisionArms.id,
        posteriorAlpha: decisionArms.posteriorAlpha,
        posteriorBeta: decisionArms.posteriorBeta,
      })
      .from(decisionArms)
      .where(
        and(
          eq(decisionArms.teamId, teamId),
          eq(decisionArms.contentType, contentType),
          eq(decisionArms.active, true)
        )
      );

    if (arms.length === 0) return undefined;
    if (arms.length === 1) return arms[0].id; // Only one arm — no sampling needed

    // Thompson Sampling: draw from each arm's Beta posterior, pick the highest
    let bestId = arms[0].id;
    let bestDraw = -1;
    for (const arm of arms) {
      const draw = betaSample(arm.posteriorAlpha, arm.posteriorBeta);
      if (draw > bestDraw) {
        bestDraw = draw;
        bestId = arm.id;
      }
    }
    return bestId;
  } catch {
    // Non-fatal — arm assignment failure degrades gracefully (armId = undefined)
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runGenerationOrchestrator(
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  // Arm assignment is independent of critic enable/disable — always attempt
  const armId = await sampleArm(input.teamId, input.contentType);
  if (armId !== undefined) {
    console.log(
      `[ARM_ASSIGNED] type=${input.contentType} id=${input.contentId} armId=${armId}`
    );
  }

  const globalDisabled = process.env.DISABLE_CRITIC_LOOP === "true";
  if (globalDisabled) {
    return { ...passthroughResult(input), armId };
  }

  const modeKey = `ORCHESTRATOR_MODE_${input.contentType.toUpperCase()}`;
  const mode = (process.env[modeKey] ?? "active") as "active" | "shadow" | "off";
  if (mode === "off") {
    return { ...passthroughResult(input), armId };
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
    // Non-fatal
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
    return { ...passthroughResult(input), armId };
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
    // orchestrated=false: shadow mode does NOT govern production output
    return {
      content: input.content,
      repairs: repairResult.repairs,
      qualityScore: repairResult.qualityScore,
      status: repairResult.status,
      review: repairResult.review,
      patternsInjected: input.patternsUsed,
      orchestrated: false,
      armId,
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
    armId,
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
