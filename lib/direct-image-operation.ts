import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, getTxDb } from "@/lib/db";
import { creditReservations, usageEvents } from "@/shared/schema";
import {
  debitReservation,
  markReservationForReconciliation,
  releaseReservation,
  reserveCredits,
} from "@/lib/billing";
import { getEffectiveCreditCost } from "@/lib/credit-menu";
import { isNonReplayableProviderError } from "@/lib/cost-telemetry";
import {
  cancelCapReservation,
  checkUsageCap,
  recordUsageEvent,
} from "@/lib/usage-caps";

const OPERATION_TYPE = "section_regenerate" as const;

export class DirectImageOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DirectImageOperationError";
  }
}

function resourcePrefix(resourceType: string, resourceId: number): string {
  if (!/^[a-z_]+$/.test(resourceType) || !Number.isInteger(resourceId) || resourceId <= 0) {
    throw new Error("Direct image operation requires a valid resource identity");
  }
  return `direct-image:${resourceType}:${resourceId}:`;
}

export function directImageRunId(params: {
  resourceType: string;
  resourceId: number;
  resourceVersion: string;
  requestKey?: string | null;
}): string {
  const prefix = resourcePrefix(params.resourceType, params.resourceId);
  // The current durable resource version is deliberately the sole attempt
  // identity. Client-provided keys must not let simultaneous callers create
  // separate billing runs and bypass the per-resource provider-entry claim.
  const digest = createHash("sha256").update(params.resourceVersion).digest("hex").slice(0, 32);
  return `${prefix}${digest}:initial`;
}

async function resolveDirectImageRunId(params: {
  teamId: number;
  resourceType: string;
  resourceId: number;
  resourceVersion: string;
}): Promise<string> {
  const initial = directImageRunId(params);
  const family = initial.slice(0, -":initial".length);
  const [latest] = await db
    .select({
      id: creditReservations.id,
      runId: creditReservations.runId,
      status: creditReservations.status,
    })
    .from(creditReservations)
    .where(and(
      eq(creditReservations.teamId, params.teamId),
      sql`starts_with(${creditReservations.runId}, ${`${family}:`})`,
    ))
    .orderBy(desc(creditReservations.id))
    .limit(1);

  // A concurrently-created attempt is the serialization point: every caller
  // joins that run and races its single provider-entry claim.
  if (latest?.status === "RESERVED") return latest.runId;
  // A released attempt may be retried. Its immutable row id deterministically
  // names the next attempt, so concurrent retries still choose one run.
  if (latest) return `${family}:after-${latest.id}`;
  return initial;
}

async function assertNoUnresolvedAttempt(
  teamId: number,
  resourceType: string,
  resourceId: number,
): Promise<void> {
  const prefix = resourcePrefix(resourceType, resourceId);
  const [pending] = await db
    .select({
      runId: creditReservations.runId,
      reconciliationRequiredAt: creditReservations.reconciliationRequiredAt,
    })
    .from(creditReservations)
    .where(and(
      eq(creditReservations.teamId, teamId),
      eq(creditReservations.status, "RESERVED"),
      sql`(
        ${creditReservations.reconciliationRequiredAt} IS NOT NULL
        OR ${creditReservations.requestKey} IS NOT NULL
      )`,
      sql`starts_with(${creditReservations.runId}, ${prefix})`,
    ))
    .limit(1);
  if (pending) {
    const reconciliationRequired = pending.reconciliationRequiredAt !== null;
    throw new DirectImageOperationError(
      reconciliationRequired
        ? "A previous paid image attempt must be reconciled before regenerating this resource"
        : "Image generation is already in progress for this resource",
      409,
      reconciliationRequired ? "RECONCILIATION_REQUIRED" : "IMAGE_GENERATION_IN_PROGRESS",
      { runId: pending.runId },
    );
  }
}

type ProviderEntryClaim = "claimed" | "same_run_claimed" | "resource_busy";

async function claimProviderEntry(
  teamId: number,
  resourceType: string,
  resourceId: number,
  runId: string,
  claimToken: string,
): Promise<ProviderEntryClaim> {
  const prefix = resourcePrefix(resourceType, resourceId);
  const txDb = await getTxDb();
  return txDb.transaction(async (tx) => {
    // Serialize only the short claim transaction. The provider call happens
    // after commit, while the flagged reservation row acts as the durable lease.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${teamId}:${resourceType}:${resourceId}`}, 0))`,
    );
    const [otherClaim] = await tx
      .select({ runId: creditReservations.runId })
      .from(creditReservations)
      .where(and(
        eq(creditReservations.teamId, teamId),
        eq(creditReservations.status, "RESERVED"),
        sql`starts_with(${creditReservations.runId}, ${prefix})`,
        sql`(
          ${creditReservations.requestKey} IS NOT NULL
          OR ${creditReservations.reconciliationRequiredAt} IS NOT NULL
        )`,
      ))
      .limit(1);
    if (otherClaim) {
      return otherClaim.runId === runId ? "same_run_claimed" : "resource_busy";
    }

    const now = new Date();
    const claimed = await tx
      .update(creditReservations)
      .set({
        requestKey: claimToken,
        reconciliationRequiredAt: now,
        reconciliationReason: "direct_image_provider_entry_or_settlement_pending",
        updatedAt: now,
      })
      .where(and(
        eq(creditReservations.teamId, teamId),
        eq(creditReservations.runId, runId),
        eq(creditReservations.status, "RESERVED"),
        sql`${creditReservations.requestKey} IS NULL`,
        sql`${creditReservations.reconciliationRequiredAt} IS NULL`,
      ))
      .returning({ id: creditReservations.id });
    return claimed.length === 1 ? "claimed" : "same_run_claimed";
  });
}

async function clearOwnedProviderEntryFlag(
  teamId: number,
  runId: string,
  claimToken: string,
): Promise<boolean> {
  const cleared = await db
    .update(creditReservations)
    .set({
      reconciliationRequiredAt: null,
      reconciliationReason: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(creditReservations.teamId, teamId),
      eq(creditReservations.runId, runId),
      eq(creditReservations.status, "RESERVED"),
      eq(creditReservations.requestKey, claimToken),
      sql`${creditReservations.reconciliationRequiredAt} IS NOT NULL`,
    ))
    .returning({ id: creditReservations.id });
  return cleared.length === 1;
}

async function settleCapReservation(
  teamId: number,
  reservationId: number,
  runId: string,
): Promise<void> {
  const settled = await db
    .update(usageEvents)
    .set({ status: "completed", units: 1, jobId: runId })
    .where(and(
      eq(usageEvents.id, reservationId),
      eq(usageEvents.teamId, teamId),
      eq(usageEvents.status, "pending"),
    ))
    .returning({ id: usageEvents.id });
  if (settled.length !== 1) {
    throw new Error("Pending usage cap reservation could not be settled");
  }
}

/**
 * Executes one synchronous direct-image operation with a credit hold spanning
 * provider submission, object storage, and the final resource link.
 */
export async function runDirectImageOperation<Generated, Persisted>(params: {
  teamId: number;
  userId: number;
  resourceType: string;
  resourceId: number;
  resourceVersion: string;
  requestKey?: string | null;
  generate: () => Promise<Generated>;
  persist: (generated: Generated) => Promise<Persisted>;
  _deps?: {
    assertNoUnresolvedAttempt?: typeof assertNoUnresolvedAttempt;
    resolveRunId?: typeof resolveDirectImageRunId;
    claimProviderEntry?: typeof claimProviderEntry;
    clearOwnedProviderEntryFlag?: typeof clearOwnedProviderEntryFlag;
    getCreditCost?: typeof getEffectiveCreditCost;
    checkCap?: typeof checkUsageCap;
    reserve?: typeof reserveCredits;
    release?: typeof releaseReservation;
    markReconciliation?: typeof markReservationForReconciliation;
    debit?: typeof debitReservation;
    recordUsage?: typeof recordUsageEvent;
    settleCap?: typeof settleCapReservation;
    cancelCap?: typeof cancelCapReservation;
  };
}): Promise<Persisted> {
  const {
    teamId, userId, resourceType, resourceId, resourceVersion,
    generate, persist, _deps = {},
  } = params;
  await (_deps.assertNoUnresolvedAttempt ?? assertNoUnresolvedAttempt)(
    teamId,
    resourceType,
    resourceId,
  );

  const creditCost = await (_deps.getCreditCost ?? getEffectiveCreditCost)(OPERATION_TYPE, teamId);
  if (creditCost === null) {
    throw new DirectImageOperationError(
      "Image regeneration is not configured in the credit menu",
      503,
      "CREDIT_COST_UNAVAILABLE",
    );
  }

  const runId = await (_deps.resolveRunId ?? resolveDirectImageRunId)({
    teamId,
    resourceType,
    resourceId,
    resourceVersion,
  });
  let capReservationId: number | null = null;
  let creditHeld = false;
  let reconciliationRequired = false;

  try {
    capReservationId = await (_deps.checkCap ?? checkUsageCap)(teamId, creditCost);
    const reservation = await (_deps.reserve ?? reserveCredits)({
      teamId,
      userId,
      runId,
      operationType: OPERATION_TYPE,
      amount: creditCost,
    });
    if (!reservation.ok) {
      throw new DirectImageOperationError(
        "Insufficient credits for image regeneration",
        402,
        "CREDITS_EXHAUSTED",
        {
          creditCost: reservation.requiredCredits,
          allowanceRemaining: reservation.allowanceRemaining,
          purchasedRemaining: reservation.purchasedRemaining,
          totalRemaining: reservation.totalRemaining,
          insufficientBy: reservation.insufficientBy,
          upgradeUrl: "/settings/billing",
        },
      );
    }
    creditHeld = true;

    const claimToken = randomUUID();
    const providerEntryClaim = await (_deps.claimProviderEntry ?? claimProviderEntry)(
      teamId,
      resourceType,
      resourceId,
      runId,
      claimToken,
    );
    if (providerEntryClaim !== "claimed") {
      // Same-run callers share the winner's hold and must not release it.
      // A cross-version loser owns a distinct hold, which the catch path releases.
      if (providerEntryClaim === "same_run_claimed") creditHeld = false;
      throw new DirectImageOperationError(
        "Image generation is already in progress for this resource",
        409,
        "IMAGE_GENERATION_IN_PROGRESS",
      );
    }
    // The flag is written in the same atomic statement as the entry claim,
    // before any paid provider call. A hard kill therefore leaves a
    // reconciliation-required hold that the generic sweeper must preserve.
    reconciliationRequired = true;

    let generated: Generated;
    try {
      generated = await generate();
    } catch (error) {
      if (isNonReplayableProviderError(error)) {
        await (_deps.markReconciliation ?? markReservationForReconciliation)({
          teamId,
          runId,
          reason: "direct_image_provider_outcome_not_durable",
        });
      } else {
        const cleared = await (
          _deps.clearOwnedProviderEntryFlag ?? clearOwnedProviderEntryFlag
        )(teamId, runId, claimToken).catch(() => false);
        // Only the owner may make a proven pre-accept failure refundable.
        if (cleared) reconciliationRequired = false;
      }
      throw error;
    }

    let persisted: Persisted;
    try {
      persisted = await persist(generated);
    } catch (error) {
      reconciliationRequired = true;
      await (_deps.markReconciliation ?? markReservationForReconciliation)({
        teamId,
        runId,
        reason: "direct_image_result_not_fully_persisted",
      });
      throw error;
    }

    let debit;
    try {
      debit = await (_deps.debit ?? debitReservation)({ teamId, userId, runId });
    } catch (error) {
      reconciliationRequired = true;
      await (_deps.markReconciliation ?? markReservationForReconciliation)({
        teamId,
        runId,
        reason: "direct_image_delivered_billing_settlement_failed",
      });
      throw new DirectImageOperationError(
        "Image was stored but billing settlement is pending",
        503,
        "BILLING_RECONCILIATION_REQUIRED",
        { runId },
      );
    }
    if (!debit.ok) {
      reconciliationRequired = true;
      await (_deps.markReconciliation ?? markReservationForReconciliation)({
        teamId,
        runId,
        reason: "direct_image_delivered_billing_settlement_failed",
      });
      throw new DirectImageOperationError(
        "Image was stored but billing settlement is pending",
        503,
        "BILLING_RECONCILIATION_REQUIRED",
        { runId },
      );
    }
    creditHeld = false;

    if (capReservationId !== null) {
      try {
        await (_deps.settleCap ?? settleCapReservation)(teamId, capReservationId, runId);
      } catch {
        // The completed image and debit are durable, but the pending cap must
        // remain conservative until usage accounting is repaired.
        throw new DirectImageOperationError(
          "Image was stored but usage-cap settlement is pending",
          503,
          "USAGE_CAP_SETTLEMENT_PENDING",
          { runId },
        );
      }
      capReservationId = null;
    } else {
      await (_deps.recordUsage ?? recordUsageEvent)({
        teamId,
        action: "cap_reservation",
        units: 1,
        costEstimateCents: creditCost,
        jobId: runId,
      });
    }
    return persisted;
  } catch (error) {
    if (creditHeld && !reconciliationRequired) {
      await (_deps.release ?? releaseReservation)({
        teamId,
        userId,
        runId,
        reason: "direct_image_confirmed_pre_delivery_failure",
      }).catch(() => undefined);
    }
    if (!reconciliationRequired && capReservationId !== null) {
      await (_deps.cancelCap ?? cancelCapReservation)(capReservationId).catch(() => undefined);
    }
    throw error;
  }
}