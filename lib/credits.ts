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
    .select({ balance: creditBalances.balance })
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
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning({ balance: creditBalances.balance });

    const [ledger] = await tx
      .insert(creditLedger)
      .values({
        teamId,
        adminUserId: adminUserId ?? null,
        amount,
        balanceAfter: updated.balance,
        eventType: eventType ?? "grant",
        sourceType: sourceType ?? null,
        idempotencyKey: idempotencyKey ?? null,
        reason: reason ?? `Grant of ${amount} credits`,
      })
      .returning({ id: creditLedger.id });

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
