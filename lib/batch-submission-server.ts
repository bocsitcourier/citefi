import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobBatches } from "@/shared/schema";

export type BatchSubmissionClaim =
  | { outcome: "claimed"; batch: typeof jobBatches.$inferSelect }
  | { outcome: "conflict"; batch: typeof jobBatches.$inferSelect }
  | { outcome: "not_found" };

/**
 * The team predicate is part of the atomic write, not a follow-up authorization
 * check. Exactly one PENDING claimant can transition a batch to SUBMITTING.
 */
export async function claimBatchForSubmission(
  batchId: number,
  teamId: number,
): Promise<BatchSubmissionClaim> {
  const [batch] = await db
    .update(jobBatches)
    .set({ status: "SUBMITTING" })
    .where(
      and(
        eq(jobBatches.id, batchId),
        eq(jobBatches.teamId, teamId),
        eq(jobBatches.status, "PENDING"),
      ),
    )
    .returning();

  if (batch) return { outcome: "claimed", batch };

  const [existing] = await db
    .select()
    .from(jobBatches)
    .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)))
    .limit(1);

  return existing
    ? { outcome: "conflict", batch: existing }
    : { outcome: "not_found" };
}

/**
 * Persist queue acceptance without regressing a worker that has already moved
 * the batch from SUBMITTING to RUNNING.
 */
export async function recordBatchEnqueueAccepted(input: {
  batchId: number;
  teamId: number;
  generationParams: Record<string, unknown>;
}): Promise<boolean> {
  const [updated] = await db.update(jobBatches).set({
    status: "QUEUED",
    generationParams: input.generationParams,
  }).where(and(
    eq(jobBatches.id, input.batchId),
    eq(jobBatches.teamId, input.teamId),
    eq(jobBatches.status, "SUBMITTING"),
  )).returning({ id: jobBatches.id });
  return Boolean(updated);
}