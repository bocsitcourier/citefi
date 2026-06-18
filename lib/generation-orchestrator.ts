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
import { eq, and, inArray } from "drizzle-orm";

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
  /**
   * Pre-sampled arm ID from sampleArmForType().
   * When provided, skips the internal sampleArm() DB query so callers that
   * pre-sample a shared arm (e.g. social post across concurrent platform variants)
   * don't pay an extra DB round-trip per variant.
   */
  armIdOverride?: number;
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
// Content-type alias map
// ---------------------------------------------------------------------------
// The decisions API (app/api/decisions/) stores social arms with contentType
// "social_post", while ContentType.SOCIAL = "social". sampleArm() resolves
// both via inArray so active social experiments are always found.
const CONTENT_TYPE_ALIASES: Record<string, string[]> = {
  social: ["social", "social_post"],
  social_post: ["social", "social_post"],
};

// ---------------------------------------------------------------------------
// Thompson Sampling — Beta distribution sampler
// ---------------------------------------------------------------------------

/** Minimal Beta(a, b) sampler using Joehnk's method (small params) or normal
 *  approximation (large params). Used for Thompson Sampling arm selection.
 *
 *  Threshold lowered from >40 to >=20: Joehnk's acceptance probability drops
 *  sharply when both params approach 10 (x+y ≈ 1 almost always), causing
 *  near-infinite loops. Normal approx is accurate for a+b >= 20.
 *  A 200-iteration safety guard further prevents any pathological case.
 */
function betaSample(alpha: number, beta: number): number {
  const a = Math.max(alpha, 0.01);
  const b = Math.max(beta, 0.01);
  // Normal approximation — accurate and fast for a+b >= 20
  if (a + b >= 20) {
    const mu = a / (a + b);
    const v = (a * b) / ((a + b) ** 2 * (a + b + 1));
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
    return Math.max(1e-6, Math.min(1 - 1e-6, mu + Math.sqrt(v) * z));
  }
  // Joehnk's method — exact for small a, b
  // Safety guard: fall back to normal approx after 200 rejections to prevent
  // any pathological near-infinite loop (e.g. a=9, b=9 has low acceptance).
  let x: number, y: number;
  let iters = 0;
  do {
    x = Math.pow(Math.random(), 1 / a);
    y = Math.pow(Math.random(), 1 / b);
    if (++iters > 200) {
      const mu = a / (a + b);
      const v = (a * b) / ((a + b) ** 2 * (a + b + 1));
      const z =
        Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-12))) *
        Math.cos(2 * Math.PI * Math.random());
      return Math.max(1e-6, Math.min(1 - 1e-6, mu + Math.sqrt(v) * z));
    }
  } while (x + y > 1);
  return x / (x + y);
}

/**
 * Decision policy hook: select a decision arm for this generation via Thompson Sampling.
 * Queries active arms for the team+contentType (with alias expansion so "social" also
 * matches arms stored as "social_post" by the decisions API), samples each
 * Beta(posteriorAlpha, posteriorBeta) posterior, and returns the arm with the highest draw.
 * Returns undefined when no active experiment exists for this team+contentType.
 */
async function sampleArm(teamId: number, contentType: string): Promise<number | undefined> {
  try {
    // Expand to all aliases — "social" must also match "social_post" (decisions API canonical)
    const aliases = CONTENT_TYPE_ALIASES[contentType] ?? [contentType];

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
          aliases.length === 1
            ? eq(decisionArms.contentType, aliases[0])
            : inArray(decisionArms.contentType, aliases),
          eq(decisionArms.active, true)
        )
      );

    if (arms.length === 0) {
      // Telemetry: warn when aliases were expanded (likely misconfiguration if social arms exist)
      if (aliases.length > 1) {
        console.log(
          `[ARM_SAMPLE] No active arm for team=${teamId} type=${contentType} ` +
            `(searched aliases: [${aliases.join(", ")}])`
        );
      }
      return undefined;
    }
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
  // Normalize casing once — callers may pass "ARTICLE", "article", etc.
  // All downstream comparisons use this normalized value.
  const normalizedType = input.contentType.toLowerCase();

  // Arm assignment is independent of critic enable/disable — always attempt.
  // When armIdOverride is provided (e.g. social post pre-samples once for all
  // concurrent platform variants), skip the internal sampleArm() DB query.
  const armId = input.armIdOverride !== undefined
    ? input.armIdOverride
    : await sampleArm(input.teamId, normalizedType);
  if (armId !== undefined) {
    console.log(
      `[ARM_ASSIGNED] type=${normalizedType} id=${input.contentId} armId=${armId}`
    );
  }

  const globalDisabled = process.env.DISABLE_CRITIC_LOOP === "true";
  if (globalDisabled) {
    return { ...passthroughResult(input), armId };
  }

  // Env var key uses uppercase for readability (ORCHESTRATOR_MODE_ARTICLE etc.)
  const modeKey = `ORCHESTRATOR_MODE_${normalizedType.toUpperCase()}`;
  const mode = (process.env[modeKey] ?? "active") as "active" | "shadow" | "off";
  if (mode === "off") {
    return { ...passthroughResult(input), armId };
  }

  const requireJudge =
    input.requireJudge ??
    (normalizedType === ContentType.ARTICLE ||
      normalizedType === ContentType.SOCIAL);

  // Observability: confirm this content type is wired through the orchestrator
  console.log(
    `[ORCHESTRATOR_WIRED] type=${normalizedType} id=${input.contentId} ` +
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

/**
 * Exported thin wrapper around sampleArm for callers that need to pre-sample
 * a single arm BEFORE launching concurrent generation tasks (e.g., social post
 * platform variants). Allows all variants to share one consistent arm assignment
 * rather than each drawing independently from the same posterior.
 */
export async function sampleArmForType(
  teamId: number,
  contentType: string
): Promise<number | undefined> {
  return sampleArm(teamId, contentType.toLowerCase());
}
