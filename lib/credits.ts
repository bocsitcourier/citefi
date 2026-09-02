import { eq, sql, isNull, and } from "drizzle-orm";
import { getTxDb } from "./db";
import { db } from "./db";
import { creditBalances, creditLedger, teams } from "@/shared/schema";

export const CREDIT_COSTS = {
  article: 10,
  podcast: 8,
  video: 15,
  social: 4,
} as const;

export type ProductType = keyof typeof CREDIT_COSTS;

export async function getCreditBalance(teamId: number): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`GREATEST(
        ${creditBalances.allowanceCredits} - ${creditBalances.allowanceUsed} - ${creditBalances.allowanceDebt}, 0
      ) + GREATEST(
        ${creditBalances.purchasedCredits} - ${creditBalances.purchasedUsed} - ${creditBalances.purchasedDebt}, 0
      ) - ${creditBalances.reservedCredits}`,
    })
    .from(creditBalances)
    .where(eq(creditBalances.teamId, teamId));
  return row?.balance ?? 0;
}

export async function ensureBalanceRow(teamId: number): Promise<void> {
  await db
    .insert(creditBalances)
    .values({ teamId, balance: 0 })
    .onConflictDoNothing();
}

interface DebitOptions {
  teamId: number;
  userId: number;
  productType: ProductType;
  units?: number;
  idempotencyKey: string;
  sourceType?: string;
  sourceId?: number;
  jobId?: string;
}

interface DebitResult {
  ok: boolean;
  balance: number;
  requiredCredits: number;
  ledgerRowId?: number;
}

export async function debitCredits(opts: DebitOptions): Promise<DebitResult> {
  const { teamId, userId, productType, units = 1, idempotencyKey, sourceType, sourceId, jobId } = opts;
  const amount = CREDIT_COSTS[productType] * units;

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    // Idempotency check: find an active (non-reversed) debit with this key.
    // Refunded debits have idempotencyKey set to NULL by refundCredits(), so
    // they will NOT match here — this naturally falls through to a fresh debit.
    const [existing] = await tx
      .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, idempotencyKey));

    if (existing) {
      // Legitimate network retry — same request, same idempotent result
      return { ok: true, balance: existing.balanceAfter, requiredCredits: amount, ledgerRowId: existing.id };
    }

    // Ensure balance row exists
    await tx
      .insert(creditBalances)
      .values({ teamId, balance: 0 })
      .onConflictDoNothing();

    // Atomic conditional debit: only succeeds if balance >= amount
    const [updated] = await tx
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} - ${amount}`,
        updatedAt: new Date(),
      })
      .where(
        sql`${creditBalances.teamId} = ${teamId} AND ${creditBalances.balance} >= ${amount}`
      )
      .returning({ balance: creditBalances.balance });

    if (!updated) {
      const [row] = await tx
        .select({ balance: creditBalances.balance })
        .from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));
      return { ok: false, balance: row?.balance ?? 0, requiredCredits: amount };
    }

    const [ledger] = await tx
      .insert(creditLedger)
      .values({
        teamId,
        userId,
        amount: -amount,
        balanceAfter: updated.balance,
        eventType: "debit",
        productType,
        sourceType,
        sourceId,
        jobId,
        idempotencyKey,
        reason: `${productType} generation (${units} unit${units > 1 ? "s" : ""})`,
      })
      .returning({ id: creditLedger.id });

    return { ok: true, balance: updated.balance, requiredCredits: amount, ledgerRowId: ledger?.id };
  });
}

interface GrantOptions {
  teamId: number;
  /** Set for admin-initiated grants; omit for system/Stripe grants */
  adminUserId?: number;
  amount: number;
  reason?: string;
  /** Ledger event type (default: "grant") */
  eventType?: string;
  /** Source system for audit (e.g. "stripe_subscription", "stripe_topup") */
  sourceType?: string;
  /** Idempotency key — if supplied, the grant is deduplicated on creditLedger.idempotency_key */
  idempotencyKey?: string;
}

export async function grantCredits(opts: GrantOptions): Promise<{ balance: number; ledgerRowId: number }> {
  const { teamId, adminUserId, amount, reason, eventType, sourceType, idempotencyKey } = opts;
  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    // Idempotency check: if the key already exists, return the existing ledger row balance
    if (idempotencyKey) {
      const [existing] = await tx
        .select({ id: creditLedger.id, balanceAfter: creditLedger.balanceAfter })
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        return { balance: existing.balanceAfter, ledgerRowId: existing.id };
      }
    }

    const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) throw new Error(`Team ${teamId} not found`);

    await tx
      .insert(creditBalances)
      .values({ teamId, balance: 0 })
      .onConflictDoNothing();

    const [updated] = await tx
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${amount}`,
        purchasedCredits: sql`${creditBalances.purchasedCredits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning({ balance: creditBalances.balance });
    if (!updated) throw new Error(`Credit balance row missing for team ${teamId}`);

    const [ledger] = await tx
      .insert(creditLedger)
      .values({
        teamId,
        adminUserId: adminUserId ?? null,
        amount,
        balanceAfter: updated.balance,
        eventType: eventType ?? "grant",
        bucket: "purchased",
        sourceType: sourceType ?? null,
        idempotencyKey: idempotencyKey ?? null,
        reason: reason ?? `Grant of ${amount} credits`,
      })
      .returning({ id: creditLedger.id });
    if (!ledger) throw new Error("Credit grant ledger insert failed");

    return { balance: updated.balance, ledgerRowId: ledger.id };
  });
}

export async function refundCredits(opts: {
  teamId: number;
  userId: number;
  amount: number;
  reason: string;
  sourceType?: string;
  sourceId?: number;
  debitLedgerRowId?: number;
}): Promise<{ balance: number }> {
  const { teamId, userId, amount, reason, sourceType, sourceId, debitLedgerRowId } = opts;
  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    if (debitLedgerRowId) {
      // Exact-once: atomically mark the debit as reversed AND clear its idempotencyKey.
      // Clearing the key removes it from the UNIQUE index, allowing a retry to re-debit
      // with that same key without hitting a constraint violation.
      // WHERE reversedAt IS NULL ensures this block only runs once even if called twice.
      const [marked] = await tx
        .update(creditLedger)
        .set({ reversedAt: new Date(), idempotencyKey: null })
        .where(and(
          eq(creditLedger.id, debitLedgerRowId),
          eq(creditLedger.teamId, teamId),
          isNull(creditLedger.reversedAt)
        ))
        .returning({ id: creditLedger.id });

      if (!marked) {
        // Already reversed — return current balance without double-crediting
        const [row] = await tx
          .select({ balance: creditBalances.balance })
          .from(creditBalances)
          .where(eq(creditBalances.teamId, teamId));
        return { balance: row?.balance ?? 0 };
      }
    }

    await tx
      .insert(creditBalances)
      .values({ teamId, balance: 0 })
      .onConflictDoNothing();

    const [updated] = await tx
      .update(creditBalances)
      .set({
        balance: sql`${creditBalances.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning({ balance: creditBalances.balance });
    if (!updated) throw new Error(`Credit balance row missing for team ${teamId}`);

    await tx.insert(creditLedger).values({
      teamId,
      userId,
      amount,
      balanceAfter: updated.balance,
      eventType: "refund",
      sourceType,
      sourceId,
      reason,
    });

    return { balance: updated.balance };
  });
}

/**
 * Reverse a credit grant that was issued by the billing webhook (subscription or top-up).
 * Atomically marks the grant ledger entry as reversed and subtracts the credits from the
 * team balance. The balance may go negative — this is intentional and correct when a
 * customer is refunded credits they've already partially spent.
 *
 * Safe to call multiple times: the WHERE reversedAt IS NULL makes it idempotent.
 */
export async function revokeGrantCredits(opts: {
  teamId: number;
  adminUserId?: number;
  grantLedgerRowId: number;
  amount: number;
  reason: string;
  /** Stripe refund/dispute ID. Omit only for legacy full-grant callers. */
  reversalKey?: string;
  /**
   * Reconcile to this cumulative entitlement reversal. This is deliberately
   * evaluated while the grant row is locked, so concurrent partial refunds
   * cannot both calculate their delta from the same stale balance.
   */
  targetReversedCredits?: number;
}): Promise<{ balance: number; reversed: number }> {
  const { teamId, adminUserId, grantLedgerRowId, amount, reason } = opts;
  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("Grant reversal amount must be a positive integer");
    const reversalIdempotencyKey = grantReversalIdempotencyKey(
      grantLedgerRowId, opts.reversalKey ?? String(amount)
    );
    const [existingReversal] = await tx.select({ id: creditLedger.id }).from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, reversalIdempotencyKey)).limit(1);
    if (existingReversal) {
      const [row] = await tx.select({ balance: creditBalances.balance }).from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));
      return { balance: row?.balance ?? 0, reversed: 0 };
    }
    const [grant] = await tx.select({
      amount: creditLedger.amount,
      reversedCredits: creditLedger.reversedCredits,
    }).from(creditLedger).where(and(
      eq(creditLedger.id, grantLedgerRowId),
      eq(creditLedger.teamId, teamId),
      sql`${creditLedger.eventType} = 'grant'`,
    )).for("update");
    if (!grant) throw new Error("Credit grant is unavailable for reversal");
    const reversalAmount = opts.targetReversedCredits == null
      ? amount
      : Math.max(0, opts.targetReversedCredits - grant.reversedCredits);
    if (opts.targetReversedCredits != null &&
      (!Number.isInteger(opts.targetReversedCredits) || opts.targetReversedCredits < 0 ||
        opts.targetReversedCredits > grant.amount)) {
      throw new Error("Grant reversal target is invalid");
    }
    if (reversalAmount === 0) {
      const [row] = await tx.select({ balance: creditBalances.balance }).from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));
      return { balance: row?.balance ?? 0, reversed: 0 };
    }
    // Claim only this exact grant's still-reversible entitlement. Partial
    // reversals accumulate; reversedAt is set only when the grant is exhausted.
    const [marked] = await tx
      .update(creditLedger)
      .set({
        reversedCredits: sql`${creditLedger.reversedCredits} + ${reversalAmount}`,
        reversedAt: sql`CASE WHEN ${creditLedger.reversedCredits} + ${reversalAmount} = ${creditLedger.amount}
          THEN now() ELSE ${creditLedger.reversedAt} END`,
      })
      .where(and(
        eq(creditLedger.id, grantLedgerRowId),
        eq(creditLedger.teamId, teamId),
        sql`${creditLedger.eventType} = 'grant'`,
        sql`${creditLedger.reversedCredits} + ${reversalAmount} <= ${creditLedger.amount}`
      ))
      .returning({ id: creditLedger.id, bucket: creditLedger.bucket });

    if (!marked) {
      // Already reversed by a previous call — return current balance without double-subtracting
      const [row] = await tx
        .select({ balance: creditBalances.balance })
        .from(creditBalances)
        .where(eq(creditBalances.teamId, teamId));
      return { balance: row?.balance ?? 0, reversed: 0 };
    }

    const bucket = marked.bucket === "allowance" ? "allowance" : "purchased";
    const credits = bucket === "allowance" ? creditBalances.allowanceCredits : creditBalances.purchasedCredits;
    const used = bucket === "allowance" ? creditBalances.allowanceUsed : creditBalances.purchasedUsed;
    const debt = bucket === "allowance" ? creditBalances.allowanceDebt : creditBalances.purchasedDebt;
    // Remove unspent entitlement from the grant's native bucket. If some of it
    // was spent, carry the shortfall as explicit bucket debt; never mutate only
    // the legacy balance while leaving bucket credits spendable.
    const [updated] = await tx
      .update(creditBalances)
      .set({
        [bucket === "allowance" ? "allowanceCredits" : "purchasedCredits"]:
           sql`${credits} - LEAST(${reversalAmount}, GREATEST(${credits} - ${used}, 0))`,
        [bucket === "allowance" ? "allowanceDebt" : "purchasedDebt"]:
           sql`${debt} + GREATEST(${reversalAmount} - GREATEST(${credits} - ${used}, 0), 0)`,
        balance: sql`GREATEST(${creditBalances.balance} - ${reversalAmount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning({ balance: creditBalances.balance });

    // Record the reversal in the ledger for audit trail
    await tx.insert(creditLedger).values({
      teamId,
      adminUserId: adminUserId ?? null,
      amount: -reversalAmount,
      balanceAfter: updated?.balance ?? 0,
      eventType: "grant_reversal",
      bucket,
      sourceId: grantLedgerRowId,
      idempotencyKey: reversalIdempotencyKey,
      reason,
    });

    return { balance: updated?.balance ?? 0, reversed: reversalAmount };
  });
}

export function grantReversalIdempotencyKey(grantLedgerRowId: number, reversalKey: string): string {
  if (!Number.isInteger(grantLedgerRowId) || grantLedgerRowId <= 0 || !reversalKey) {
    throw new Error("Grant reversal requires a ledger row and durable key");
  }
  return `grant-reversal:${grantLedgerRowId}:${reversalKey}`;
}
