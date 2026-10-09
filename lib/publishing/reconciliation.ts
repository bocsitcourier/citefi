import { db } from "../db";
import { and, eq, sql } from "drizzle-orm";
import { publishingJobs, publishingConnections, publishingCallbacks, users, teams, teamMembers } from "../../shared/schema";
import { decryptApiKey, hashApiKey } from "./auth/hmac";
import { dispatchContract } from "./dispatch-policy";
import { reconciliationError, verifyNativeReceipt } from "./receipt-policy";
import { safeFetchWithRedirects } from "../url-validation";
import { createHmac } from "node:crypto";
import type { PublishingJob } from "../../shared/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Operator = { userId: number; teamId: number; role: string };
export type Decision = {
  outcome: "accepted" | "not_accepted"; receiptId: number; decisionId: string;
  actorId: number; at: string; reason: string; attempt: string;
  priorStatus: string; priorError: string | null;
};
type Audit = { action: string; actorId: number; at: string; reason?: string };
type Reconciliation = { decision?: Decision; replacementJobId?: number; audit?: Audit[] };

export function reconciliationOf(job: Pick<PublishingJob, "errorDetails">): Reconciliation {
  return ((job.errorDetails as Record<string, unknown> | null)?.reconciliation ?? {}) as Reconciliation;
}
export function detailsOf(job: Pick<PublishingJob, "errorDetails">): Record<string, unknown> {
  return job.errorDetails && typeof job.errorDetails === "object" ? job.errorDetails as Record<string, unknown> : {};
}

// Re-check revocation under transaction locks, not merely the HTTP bootstrap.
export async function assertPublishingOperator(tx: Tx, operator: Operator) {
  const [team] = await tx.select().from(teams).where(eq(teams.id, operator.teamId)).for("share");
  const [user] = await tx.select().from(users).where(eq(users.id, operator.userId)).for("share");
  if (!team || team.deletedAt || team.clientStatus !== "active" ||
      !user || user.accountStatus !== "active")
    reconciliationError("Operator or workspace is no longer active", 403);
  if (operator.role === "platform_admin" && user.role === "admin") return;
  const [membership] = await tx.select().from(teamMembers).where(and(
    eq(teamMembers.teamId, operator.teamId), eq(teamMembers.userId, operator.userId),
  )).for("share");
  if (membership && ["owner", "admin"].includes(membership.role)) return;
  if (team.parentTeamId) {
    const [parent] = await tx.select().from(teams).where(eq(teams.id, team.parentTeamId)).for("share");
    const [inherited] = await tx.select().from(teamMembers).where(and(
      eq(teamMembers.teamId, team.parentTeamId), eq(teamMembers.userId, operator.userId),
    )).for("share");
    if (parent && !parent.deletedAt && parent.clientStatus === "active" &&
        inherited && ["owner", "admin"].includes(inherited.role)) return;
  }
  reconciliationError("Publishing operator access required", 403);
}

async function lockedJob(tx: Tx, operator: Operator, id: number) {
  await assertPublishingOperator(tx, operator);
  const [job] = await tx.select().from(publishingJobs).where(and(
    eq(publishingJobs.id, id), eq(publishingJobs.teamId, operator.teamId),
  )).for("update");
  if (!job) reconciliationError("Job not found", 404);
  return job;
}

export async function recordReceipt(operator: Operator, id: number, raw: string, signature: string, source: "native_import" | "pinned_read") {
  return db.transaction(async tx => {
    const job = await lockedJob(tx, operator, id);
    const [connection] = await tx.select().from(publishingConnections).where(and(
      eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, operator.teamId),
    )).for("share");
    const contract = dispatchContract(job.errorDetails);
    if (!connection || connection.deletedAt || !connection.encryptedApiKey ||
        !contract?.receiverOrigin || new URL(connection.baseUrl!).origin !== contract.receiverOrigin)
      reconciliationError("Original receiver identity is unavailable");
    const key = decryptApiKey(connection.encryptedApiKey);
    const verified = verifyNativeReceipt(raw, signature, key, job);
    const [duplicate] = await tx.select().from(publishingCallbacks).where(and(
      eq(publishingCallbacks.publishingJobId, job.id),
      sql`${publishingCallbacks.payload}->>'digest' = ${verified.digest}`,
    )).limit(1);
    if (duplicate) return { receiptId: duplicate.id, duplicate: true };
    const [conflict] = await tx.select().from(publishingCallbacks).where(and(
      eq(publishingCallbacks.publishingJobId, job.id),
      sql`${publishingCallbacks.payload}->'receipt'->>'receiptId' = ${verified.receipt.receiptId}`,
    )).limit(1);
    if (conflict) reconciliationError("Receiver receipt identifier conflicts with retained evidence");
    const [opposite] = await tx.select({ id: publishingCallbacks.id }).from(publishingCallbacks).where(and(
      eq(publishingCallbacks.publishingJobId, job.id), eq(publishingCallbacks.status, "native_evidence"),
      sql`${publishingCallbacks.payload}->'receipt'->>'outcome' <> ${verified.receipt.outcome}`,
    )).limit(1);
    const at = new Date().toISOString();
    const [stored] = await tx.insert(publishingCallbacks).values({
      publishingJobId: id, status: "native_evidence", signature,
      payload: { ...verified, raw, source, actorId: operator.userId, at } as any,
    }).returning({ id: publishingCallbacks.id });
    const reconciliation = reconciliationOf(job);
    await tx.update(publishingJobs).set({
      errorDetails: { ...detailsOf(job),
        ...(opposite || (job.status === "delivered" && verified.receipt.outcome === "not_accepted") ||
          (reconciliation.decision && reconciliation.decision.outcome !== verified.receipt.outcome)
          ? { reconciliationConflict: true } : {}),
        reconciliation: { ...reconciliation,
        audit: [...(reconciliation.audit ?? []), { action: "receipt_recorded", actorId: operator.userId, at }],
      } }, updatedAt: new Date(),
    }).where(and(eq(publishingJobs.id, id), eq(publishingJobs.teamId, operator.teamId)));
    return { receiptId: stored!.id, duplicate: false };
  });
}

export async function adjudicate(operator: Operator, id: number, input: {
  receiptId: number; decisionId: string; reason: string;
  expectedAttempt: string; expectedStatus: string; expectedUpdatedAt: string;
}) {
  return db.transaction(async tx => {
    const job = await lockedJob(tx, operator, id);
    const retained = reconciliationOf(job);
    if (retained.decision) {
      if (retained.decision.decisionId === input.decisionId &&
          retained.decision.receiptId === input.receiptId && retained.decision.reason === input.reason)
        return { decision: retained.decision, duplicate: true };
      reconciliationError("This operation has already been adjudicated");
    }
    if (!["outcome_unknown", "processing", "sent"].includes(job.status) ||
        !job.lastAttemptAt || job.lastAttemptAt.toISOString() !== input.expectedAttempt ||
        job.status !== input.expectedStatus || job.updatedAt.toISOString() !== input.expectedUpdatedAt)
      reconciliationError("Operation changed; refresh evidence before deciding");
    const [evidence] = await tx.select().from(publishingCallbacks).where(and(
      eq(publishingCallbacks.id, input.receiptId), eq(publishingCallbacks.publishingJobId, id),
      eq(publishingCallbacks.status, "native_evidence"),
    )).limit(1);
    if (!evidence) reconciliationError("Verified native evidence is required");
    const stored = evidence.payload as unknown as { raw: string };
    const [connection] = await tx.select().from(publishingConnections).where(and(
      eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, operator.teamId),
    )).for("share");
    const contract = dispatchContract(job.errorDetails);
    if (!connection || connection.deletedAt || !connection.encryptedApiKey ||
        new URL(connection.baseUrl!).origin !== contract?.receiverOrigin)
      reconciliationError("Original receiver identity is unavailable");
    const { receipt } = verifyNativeReceipt(stored.raw, evidence.signature ?? "", decryptApiKey(connection.encryptedApiKey), job);
    // Contradictory native evidence can never be selectively adjudicated.
    const contradictory = await tx.select({ id: publishingCallbacks.id }).from(publishingCallbacks).where(and(
      eq(publishingCallbacks.publishingJobId, id), eq(publishingCallbacks.status, "native_evidence"),
      sql`${publishingCallbacks.payload}->'receipt'->>'outcome' <> ${receipt.outcome}`,
    )).limit(1);
    if (contradictory.length) reconciliationError("Conflicting native evidence; keep the operation paused");
    const decision: Decision = {
      outcome: receipt.outcome, receiptId: evidence.id, decisionId: input.decisionId,
      actorId: operator.userId, at: new Date().toISOString(), reason: input.reason, attempt: input.expectedAttempt,
      priorStatus: job.status, priorError: job.lastError,
    };
    await tx.update(publishingJobs).set({
      status: receipt.outcome === "accepted" ? "delivered" : "not_accepted",
      ...(receipt.outcome === "accepted" ? { publishedUrl: receipt.pageUrl, publishedAt: new Date() } : {}),
      nextRetryAt: null, lastError: null, updatedAt: new Date(),
      errorDetails: { ...detailsOf(job), reconciliationRequired: false,
        reconciliation: { ...retained, decision, audit: [...(retained.audit ?? []),
          { action: "adjudicated", actorId: operator.userId, at: decision.at, reason: input.reason }] },
      },
    }).where(and(eq(publishingJobs.id, id), eq(publishingJobs.teamId, operator.teamId),
      eq(publishingJobs.status, input.expectedStatus), eq(publishingJobs.lastAttemptAt, job.lastAttemptAt),
      eq(publishingJobs.updatedAt, job.updatedAt)));
    return { decision, duplicate: false };
  });
}

export async function reconciliationView(operator: Operator, id: number) {
  return db.transaction(async tx => {
    const job = await lockedJob(tx, operator, id);
    const [connection] = await tx.select().from(publishingConnections).where(and(
      eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, operator.teamId),
    ));
    const contract = dispatchContract(job.errorDetails);
    const records = await tx.select().from(publishingCallbacks).where(and(
      eq(publishingCallbacks.publishingJobId, id), eq(publishingCallbacks.status, "native_evidence"),
    ));
    const retained = reconciliationOf(job);
    return {
      jobId: id, publicId: job.publicId, status: job.status, attempt: job.lastAttemptAt?.toISOString() ?? null,
      updatedAt: job.updatedAt.toISOString(),
      legacy: !contract?.receiverOrigin || !contract.receiverKeyHash || !contract.submissionStarted || !job.lastAttemptAt,
      receiverOrigin: contract?.receiverOrigin ?? null,
      canLiveCheck: !!connection && !connection.deletedAt && connection.status === "active" &&
        connection.capabilities?.publishingReceiptV1 === true &&
        !!contract?.receiverOrigin && new URL(connection.baseUrl!).origin === contract.receiverOrigin,
      decision: retained.decision ?? null, replacementJobId: retained.replacementJobId ?? null,
      conflict: detailsOf(job).reconciliationConflict === true,
      receipts: records.map(row => {
        const payload = row.payload as any;
        return { id: row.id, ...payload.receipt, digest: payload.digest,
          source: payload.source, at: payload.at, actorId: payload.actorId };
      }),
      audit: retained.audit ?? [],
    };
  });
}

/** Fixed GET only, public DNS pinning, no redirects, bounded body/time and
 * signed native outcome. A 404/timeout/unsigned body is never negative proof. */
export async function checkReceiver(operator: Operator, id: number, origin: string) {
  const view = await reconciliationView(operator, id);
  if (view.legacy || !view.canLiveCheck || view.receiverOrigin !== origin || !view.attempt)
    reconciliationError("Read-only receiver protocol is unavailable for this original attempt");
  const target = `${origin}/api/v1/publishing/receipts/${view.publicId}?dispatchAttempt=${encodeURIComponent(view.attempt)}`;
  // Persist separate authorization before any network call (even failed reads).
  const readKey = await db.transaction(async tx => {
    const job = await lockedJob(tx, operator, id);
    if (job.lastAttemptAt?.toISOString() !== view.attempt) reconciliationError("Attempt changed");
    const retained = reconciliationOf(job);
    const [connection] = await tx.select().from(publishingConnections).where(and(
      eq(publishingConnections.id, job.connectionId), eq(publishingConnections.teamId, operator.teamId),
    )).for("share");
    if (!connection || connection.deletedAt || connection.status !== "active" || !connection.encryptedApiKey ||
        connection.capabilities?.publishingReceiptV1 !== true ||
        new URL(connection.baseUrl!).origin !== origin ||
        connection.apiKeyHash !== dispatchContract(job.errorDetails)?.receiverKeyHash)
      reconciliationError("Original receiver identity changed; no read was sent");
    await tx.update(publishingJobs).set({ errorDetails: { ...detailsOf(job),
      reconciliation: { ...retained, audit: [...(retained.audit ?? []),
        { action: "live_read_authorized", actorId: operator.userId, at: new Date().toISOString() }] },
    }, updatedAt: new Date() }).where(and(eq(publishingJobs.id, id), eq(publishingJobs.teamId, operator.teamId)));
    const key = decryptApiKey(connection.encryptedApiKey);
    if (hashApiKey(key) !== dispatchContract(job.errorDetails)?.receiverKeyHash)
      reconciliationError("Original receiver key no longer matches");
    return key;
  });
  const timestamp = String(Date.now());
  const readPath = new URL(target).pathname + new URL(target).search;
  const signature = createHmac("sha256", readKey).update(`publishing-receipt-read-v1.${timestamp}.${readPath}`).digest("hex");
  const response = await safeFetchWithRedirects(target, {
    method: "GET", maxRedirects: 0, timeoutMs: 5000, deadlineMs: 5000, maxBytes: 32768,
    headers: { Accept: "application/json", "x-citefi-timestamp": timestamp, "x-citefi-receipt-read-signature": signature },
  });
  if (!response?.ok) reconciliationError("Receiver check was inconclusive; no retry was authorized");
  return recordReceipt(operator, id, await response.text(), response.headers.get("x-citefi-receipt-signature") ?? "", "pinned_read");
}
