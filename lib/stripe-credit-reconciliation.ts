import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { creditLedger, stripeCreditReconciliations } from "@/shared/schema";
import { revokeGrantCredits } from "./credits";

export interface StripeReversalMessage {
  providerObjectId: string;
  objectType: "refund" | "dispute";
  teamId: number;
  chargeId: string;
  refundId?: string;
  disputeId?: string;
  invoiceId?: string;
  paymentIntentId?: string;
  /** Stripe's authoritative cumulative amount refunded for this charge. */
  currencyAmount: number;
  originalChargeAmount: number;
  payload?: unknown;
  adminUserId?: number;
}

export const STRIPE_RECONCILIATION_MAX_ATTEMPTS = 8;
const STRIPE_RECONCILIATION_BATCH_SIZE = 50;

function retryDelayMs(attempts: number): number {
  // 1m, 2m, 4m ... capped at one hour. Bounded retries go to the terminal
  // operator-visible path rather than spinning forever.
  return Math.min(60 * 60_000, 60_000 * (2 ** Math.max(0, attempts - 1)));
}

export function proportionalCreditReversal(grantCredits: number, refundedAmount: number, chargeAmount: number): number {
  if (![grantCredits, refundedAmount, chargeAmount].every(Number.isSafeInteger)
      || grantCredits < 0 || refundedAmount < 0 || chargeAmount <= 0 || refundedAmount > chargeAmount) {
    throw new Error("Invalid proportional Stripe reversal inputs");
  }
  return refundedAmount === chargeAmount
    ? grantCredits
    : Math.floor((grantCredits * refundedAmount) / chargeAmount);
}

/** The only safe delta for a Stripe cumulative refund total. */
export function cumulativeCreditReversalDelta(
  grantCredits: number,
  cumulativeRefundedAmount: number,
  chargeAmount: number,
  alreadyReversedCredits: number,
): number {
  if (!Number.isSafeInteger(alreadyReversedCredits) || alreadyReversedCredits < 0) {
    throw new Error("Invalid already-reversed credit total");
  }
  return Math.max(0, proportionalCreditReversal(
    grantCredits, cumulativeRefundedAmount, chargeAmount,
  ) - alreadyReversedCredits);
}

/** Stripe opens disputes before deciding them; only a terminal loss revokes. */
export function shouldReverseStripeDispute(status: string | null | undefined): boolean {
  return status === "lost";
}

/** Durable inbox/outbox. A committed pending row is safe to retry indefinitely. */
export async function enqueueStripeCreditReversal(message: StripeReversalMessage): Promise<void> {
  await db.insert(stripeCreditReconciliations).values({
    teamId: message.teamId,
    providerObjectId: message.providerObjectId,
    objectType: message.objectType,
    chargeId: message.chargeId,
    refundId: message.refundId,
    disputeId: message.disputeId,
    invoiceId: message.invoiceId,
    paymentIntentId: message.paymentIntentId,
    currencyAmount: message.currencyAmount,
    payload: { ...message, payload: message.payload } as any,
  }).onConflictDoNothing({ target: stripeCreditReconciliations.providerObjectId });
  await processStripeCreditReversal(message.providerObjectId);
}

export async function processStripeCreditReversal(providerObjectId: string): Promise<void> {
  const [work] = await db.update(stripeCreditReconciliations).set({
    status: "processing", attempts: sql`${stripeCreditReconciliations.attempts} + 1`, updatedAt: new Date(),
  }).where(and(
    eq(stripeCreditReconciliations.providerObjectId, providerObjectId),
    inArray(stripeCreditReconciliations.status, ["pending", "failed"]),
    lte(stripeCreditReconciliations.nextAttemptAt, new Date()),
    sql`${stripeCreditReconciliations.attempts} < ${STRIPE_RECONCILIATION_MAX_ATTEMPTS}`
  )).returning();
  // This conditional update is the atomic claim: a concurrent sweeper or
  // webhook sees no row once another worker has claimed it as processing.
  if (!work) return;
  const message = work.payload as unknown as StripeReversalMessage;
  try {
    const [grant] = await db.select().from(creditLedger).where(and(
      eq(creditLedger.teamId, work.teamId),
      sql`${creditLedger.eventType}='grant'`,
      work.invoiceId
        ? sql`(${creditLedger.stripeInvoiceId}=${work.invoiceId} OR ${creditLedger.idempotencyKey}=${`invoice-grant-${work.invoiceId}`})`
        : work.paymentIntentId
          ? eq(creditLedger.stripePaymentIntentId, work.paymentIntentId)
          : sql`false`
    )).limit(1);
    if (!grant) throw new Error(`No credit grant found for Stripe payment provenance`);
    if (!Number.isInteger(message.originalChargeAmount) || message.originalChargeAmount <= 0) {
      throw new Error("Original Stripe charge amount is unavailable");
    }
    // Deterministic proportional reversal. The final refund absorbs integer
    // rounding because Stripe reports the cumulative refunded amount.
    // Stripe supplies a cumulative amount_refunded. Subtract the grant's
    // existing reversal rather than reversing each partial refund independently.
    // revokeGrantCredits repeats this calculation under a row lock to close the
    // concurrent-webhook race.
    const targetCredits = grant.reversedCredits + cumulativeCreditReversalDelta(
      grant.amount, message.currencyAmount, message.originalChargeAmount, grant.reversedCredits,
    );
    let credits = 0;
    if (targetCredits > 0) {
      const reversal = await revokeGrantCredits({
        teamId: work.teamId,
        adminUserId: message.adminUserId ?? grant.adminUserId ?? undefined,
        grantLedgerRowId: grant.id,
        // amount remains required for legacy callers; the target is the
        // authoritative cumulative Stripe entitlement to remove.
        amount: targetCredits,
        targetReversedCredits: targetCredits,
        reason: `Stripe ${work.objectType} ${providerObjectId} for charge ${work.chargeId}`,
        reversalKey: providerObjectId,
      });
      credits = reversal.reversed;
    }
    await db.update(stripeCreditReconciliations).set({
      originalGrantId: grant.id, creditsReversed: credits, status: "completed",
      processedAt: new Date(), lastError: null, updatedAt: new Date(),
    }).where(eq(stripeCreditReconciliations.id, work.id));
  } catch (error: any) {
    const terminal = work.attempts >= STRIPE_RECONCILIATION_MAX_ATTEMPTS;
    await db.update(stripeCreditReconciliations).set({
      status: terminal ? "cancelled" : "failed", lastError: error?.message ?? String(error),
      nextAttemptAt: new Date(Date.now() + retryDelayMs(work.attempts)), updatedAt: new Date(),
    }).where(eq(stripeCreditReconciliations.id, work.id));
    if (terminal) {
      console.error(`🚨 [stripe-credit-reconciliation] terminal failure for ${providerObjectId} after ${work.attempts} attempts:`, error);
    }
    throw error;
  }
}

/** System-scoped durable retry sweep. Individual rows are atomically claimed. */
export async function sweepDueStripeCreditReconciliations(limit = STRIPE_RECONCILIATION_BATCH_SIZE): Promise<number> {
  const due = await db.select({ providerObjectId: stripeCreditReconciliations.providerObjectId })
    .from(stripeCreditReconciliations)
    .where(and(
      inArray(stripeCreditReconciliations.status, ["pending", "failed"]),
      lte(stripeCreditReconciliations.nextAttemptAt, new Date()),
      sql`${stripeCreditReconciliations.attempts} < ${STRIPE_RECONCILIATION_MAX_ATTEMPTS}`,
    ))
    .orderBy(asc(stripeCreditReconciliations.nextAttemptAt))
    .limit(Math.min(Math.max(1, limit), STRIPE_RECONCILIATION_BATCH_SIZE));
  let claimed = 0;
  for (const row of due) {
    try {
      await processStripeCreditReversal(row.providerObjectId);
      claimed++;
    } catch {
      // The row has its bounded retry state persisted; process the remaining
      // due rows instead of abandoning the sweep.
    }
  }
  return claimed;
}