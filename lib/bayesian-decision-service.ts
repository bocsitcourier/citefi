/**
 * Bayesian Decisioning Service — T016
 *
 * Thompson Sampling over Beta-Bernoulli arms with deterministic holdout
 * assignment. Sticky assignments ensure the same visitor always sees the
 * same arm (or is always in holdout) for a given policy.
 */

import { createHash } from "crypto";
import { db, getTxDb } from "@/lib/db";
import { decisionPolicies, decisionArms, holdoutAssignments } from "@/shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

// ─── Beta distribution sampler ────────────────────────────────────────────────
// Uses ratio-of-Gamma-variates method (Marsaglia & Tsang 2000 for Gamma sampling).

function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleGamma(shape: number): number {
  if (shape < 1) return sampleGamma(1 + shape) * Math.random() ** (1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randomNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(Math.max(alpha, 1e-9));
  const y = sampleGamma(Math.max(beta, 1e-9));
  return x / (x + y);
}

// ─── Visitor hashing ──────────────────────────────────────────────────────────

function hashVisitor(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 64);
}

/**
 * Deterministic holdout decision — same visitor always gets the same result.
 * Uses a separate hash key to decouple holdout from arm selection.
 */
function isInHoldout(
  policyId: number,
  visitorId: string,
  holdoutPercent: number
): boolean {
  const buf = createHash("sha256")
    .update(`holdout:${policyId}:${visitorId}`)
    .digest();
  const uint32 = buf.readUInt32BE(0);
  return uint32 % 10_000 < Math.round(holdoutPercent * 10_000);
}

// ─── Core service functions ───────────────────────────────────────────────────

export interface SelectArmResult {
  armId: number | null;
  isHoldout: boolean;
  cached: boolean;
}

/**
 * Select an arm for a visitor using Thompson Sampling.
 * Assignments are sticky — the same (policyId, visitorId) pair always returns
 * the same arm (or the same holdout status).
 */
export async function selectArm(
  policyId: number,
  visitorId: string
): Promise<SelectArmResult> {
  const visitorHash = hashVisitor(visitorId);

  // Sticky assignment lookup
  const [existing] = await db
    .select()
    .from(holdoutAssignments)
    .where(
      and(
        eq(holdoutAssignments.policyId, policyId),
        eq(holdoutAssignments.visitorHash, visitorHash)
      )
    )
    .limit(1);

  if (existing) {
    return { armId: existing.armId, isHoldout: existing.isHoldout, cached: true };
  }

  // Fetch active policy
  const [policy] = await db
    .select()
    .from(decisionPolicies)
    .where(
      and(
        eq(decisionPolicies.id, policyId),
        eq(decisionPolicies.active, true)
      )
    )
    .limit(1);

  if (!policy) {
    throw Object.assign(new Error("Policy not found or inactive"), { statusCode: 404 });
  }

  // Holdout check (deterministic)
  const holdout = isInHoldout(policyId, visitorId, policy.holdoutPercent);

  if (holdout) {
    // onConflictDoNothing + returning: if two concurrent requests race, only
    // the first insert wins. The loser re-reads what was actually stored.
    const inserted = await db
      .insert(holdoutAssignments)
      .values({ teamId: policy.teamId, policyId, visitorHash, isHoldout: true, armId: null })
      .onConflictDoNothing()
      .returning({ armId: holdoutAssignments.armId, isHoldout: holdoutAssignments.isHoldout });

    if (inserted.length > 0) {
      return { armId: null, isHoldout: true, cached: false };
    }
    const [stored] = await db
      .select({ armId: holdoutAssignments.armId, isHoldout: holdoutAssignments.isHoldout })
      .from(holdoutAssignments)
      .where(and(eq(holdoutAssignments.policyId, policyId), eq(holdoutAssignments.visitorHash, visitorHash)))
      .limit(1);
    return { armId: stored?.armId ?? null, isHoldout: stored?.isHoldout ?? true, cached: true };
  }

  // Fetch active arms and Thompson-sample
  const arms = await db
    .select()
    .from(decisionArms)
    .where(and(eq(decisionArms.policyId, policyId), eq(decisionArms.active, true)));

  if (arms.length === 0) {
    throw Object.assign(new Error("No active arms for policy"), { statusCode: 422 });
  }

  let bestArm = arms[0]!;
  let bestSample = -Infinity;
  for (const arm of arms) {
    const sample = sampleBeta(arm.posteriorAlpha, arm.posteriorBeta);
    if (sample > bestSample) {
      bestSample = sample;
      bestArm = arm;
    }
  }

  // Insert with conflict guard; re-read on conflict so the response reflects
  // what is actually persisted (not this request's sampled arm).
  const inserted = await db
    .insert(holdoutAssignments)
    .values({ teamId: policy.teamId, policyId, visitorHash, isHoldout: false, armId: bestArm.id })
    .onConflictDoNothing()
    .returning({ armId: holdoutAssignments.armId, isHoldout: holdoutAssignments.isHoldout });

  if (inserted.length > 0) {
    return { armId: bestArm.id, isHoldout: false, cached: false };
  }
  const [stored] = await db
    .select({ armId: holdoutAssignments.armId, isHoldout: holdoutAssignments.isHoldout })
    .from(holdoutAssignments)
    .where(and(eq(holdoutAssignments.policyId, policyId), eq(holdoutAssignments.visitorHash, visitorHash)))
    .limit(1);
  return { armId: stored?.armId ?? bestArm.id, isHoldout: stored?.isHoldout ?? false, cached: true };
}

/**
 * Record an impression or conversion outcome for a visitor's assigned arm.
 *
 * Idempotent state machine per assignment:  null → "impression" → "conversion"
 * (one-way — conversions are never downgraded back to impressions).
 *
 * Posterior update is a single atomic SQL statement — no read-modify-write
 * race. The arm's Beta posteriors are maintained via the conjugate update:
 *   posteriorAlpha = priorAlpha + (all conversions so far)
 *   posteriorBeta  = priorBeta  + (all impressions so far − all conversions)
 *
 * Holdout visitors are silently skipped — their data must not pollute posteriors.
 */
export async function recordOutcome(
  policyId: number,
  visitorId: string,
  outcome: "impression" | "conversion"
): Promise<{ ok: boolean; skipped: boolean }> {
  const visitorHash = hashVisitor(visitorId);

  // Fast pre-check to short-circuit obviously-invalid cases before opening a tx
  const [preCheck] = await db
    .select({ id: holdoutAssignments.id, armId: holdoutAssignments.armId, isHoldout: holdoutAssignments.isHoldout })
    .from(holdoutAssignments)
    .where(and(eq(holdoutAssignments.policyId, policyId), eq(holdoutAssignments.visitorHash, visitorHash)))
    .limit(1);

  if (!preCheck) {
    return { ok: true, skipped: true };
  }

  // Holdout visitors: record outcome for baseline comparison (T017 holdout lift)
  // but do NOT update any arm posteriors — holdout must remain uncontaminated.
  if (preCheck.isHoldout) {
    let transitioned = false;
    const hTxDb = getTxDb();
    await hTxDb.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(holdoutAssignments)
        .where(and(eq(holdoutAssignments.policyId, policyId), eq(holdoutAssignments.visitorHash, visitorHash)))
        .limit(1)
        .for("update");

      if (!locked || !locked.isHoldout) return;
      const current = locked.outcome as "impression" | "conversion" | null;
      if (current === "conversion" || current === outcome) return;
      // Valid transitions: null→impression, null→conversion, impression→conversion
      if (current !== null && !(current === "impression" && outcome === "conversion")) return;
      await tx
        .update(holdoutAssignments)
        .set({ outcome })
        .where(eq(holdoutAssignments.id, locked.id));
      transitioned = true;
    });
    return { ok: true, skipped: !transitioned };
  }

  if (!preCheck.armId) {
    return { ok: true, skipped: true };
  }

  // Treatment visitors: full state machine + arm posterior update
  // Open a transaction and lock the assignment row (FOR UPDATE) so concurrent
  // outcome updates for the same visitor serialize. The lock ensures each
  // transition reads the committed state — no stale-outcome race possible.
  let transitioned = false;
  const txDb = getTxDb();

  await txDb.transaction(async (tx) => {
    // Lock the row — serializes concurrent calls on this (policyId, visitorHash)
    const [assignment] = await tx
      .select()
      .from(holdoutAssignments)
      .where(and(eq(holdoutAssignments.policyId, policyId), eq(holdoutAssignments.visitorHash, visitorHash)))
      .limit(1)
      .for("update");

    if (!assignment || assignment.isHoldout || !assignment.armId) return;

    const current = assignment.outcome as "impression" | "conversion" | null;

    // Already at or past target state — idempotent
    if (current === "conversion" || current === outcome) return;

    // Compute transition deltas from the fresh (locked) row
    let impDelta = 0;
    let convDelta = 0;
    if (current === null && outcome === "impression") {
      impDelta = 1;
    } else if (current === null && outcome === "conversion") {
      impDelta = 1;
      convDelta = 1;
    } else if (current === "impression" && outcome === "conversion") {
      convDelta = 1;
    } else {
      return;
    }

    // Transition outcome state machine
    await tx
      .update(holdoutAssignments)
      .set({ outcome })
      .where(eq(holdoutAssignments.id, assignment.id));

    // Atomic single-statement arm posterior update (RHS refs OLD column values)
    await tx
      .update(decisionArms)
      .set({
        impressions: sql`${decisionArms.impressions} + ${impDelta}`,
        conversions: sql`${decisionArms.conversions} + ${convDelta}`,
        posteriorAlpha: sql`${decisionArms.priorAlpha} + ${decisionArms.conversions} + ${convDelta}`,
        posteriorBeta: sql`GREATEST(1e-9::float8, ${decisionArms.priorBeta} + (${decisionArms.impressions} + ${impDelta}) - (${decisionArms.conversions} + ${convDelta}))`,
        lastUpdated: new Date(),
      })
      .where(eq(decisionArms.id, assignment.armId!));

    transitioned = true;
  });

  return { ok: true, skipped: !transitioned };
}

/**
 * Create a new decision policy for a team.
 */
export async function createPolicy(data: {
  teamId: number;
  contentType?: string;
  objective?: string;
  explorationRate?: number;
  holdoutPercent?: number;
}): Promise<typeof decisionPolicies.$inferSelect> {
  const [policy] = await db
    .insert(decisionPolicies)
    .values({
      teamId: data.teamId,
      contentType: data.contentType ?? "article",
      objective: data.objective ?? "maximize_conversions",
      explorationRate: data.explorationRate ?? 0.1,
      holdoutPercent: data.holdoutPercent ?? 0.1,
      active: true,
    })
    .returning();
  return policy;
}

/**
 * Register a content variant as an arm in a policy.
 */
export async function createArm(data: {
  policyId: number;
  teamId: number;
  contentType: string;
  articleId?: number | null;
  socialPostId?: number | null;
  label?: string | null;
  priorAlpha?: number;
  priorBeta?: number;
}): Promise<typeof decisionArms.$inferSelect> {
  const alpha = Math.max(1e-9, data.priorAlpha ?? 1.0);
  const beta = Math.max(1e-9, data.priorBeta ?? 1.0);
  const [arm] = await db
    .insert(decisionArms)
    .values({
      policyId: data.policyId,
      teamId: data.teamId,
      contentType: data.contentType,
      articleId: data.articleId ?? null,
      socialPostId: data.socialPostId ?? null,
      label: data.label ?? null,
      priorAlpha: alpha,
      priorBeta: beta,
      posteriorAlpha: alpha,
      posteriorBeta: beta,
      impressions: 0,
      conversions: 0,
      active: true,
    })
    .returning();
  return arm;
}
