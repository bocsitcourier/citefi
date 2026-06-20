/**
 * lib/billing.ts — Two-bucket atomic credit metering engine
 *
 * Implements the canonical RESERVE → DEBIT / RELEASE flow:
 *   1. reserveCredits()  — before enqueueing a job (atomic, blocks overdraft)
 *   2. debitCredits()    — on successful completion (converts reservation)
 *   3. releaseCredits()  — on failure (cancels reservation, no charge)
 *
 * Consumption order: allowance depleted first, then purchased top-ups.
 * No negative balances. No grace period.
 */

import { eq, sql } from "drizzle-orm";
import { getTxDb, db } from "./db";
import { creditBalances, creditLedger, teams } from "@/shared/schema";
import { getCreditCost, type OperationType } from "./credit-menu";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BucketBalance {
  allowanceCredits: number;
  purchasedCredits: number;
  allowanceUsed: number;
  purchasedUsed: number;
  reservedCredits: number;
  allowanceRemaining: number;
  purchasedRemaining: number;
  totalRemaining: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface ReserveResult {
  ok: boolean;
  runId: string;
  requiredCredits: number;
  allowanceRemaining: number;
  purchasedRemaining: number;
  totalRemaining: number;
  /** Only set when ok=false */
  insufficientBy?: number;
}

export interface DebitResult {
  ok: boolean;
  fromAllowance: number;
  fromPurchased: number;
  allowanceRemaining: number;
  purchasedRemaining: number;
  totalRemaining: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function ensureBucketRow(teamId: number, tx: any): Promise<void> {
  await tx
    .insert(creditBalances)
    .values({
      teamId,
      balance: 0,
      allowanceCredits: 0,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
    })
    .onConflictDoNothing();
}

function computeRemaining(row: {
  allowanceCredits: number;
  purchasedCredits: number;
  allowanceUsed: number;
  purchasedUsed: number;
  reservedCredits: number;
}) {
  const allowanceRemaining = Math.max(0, row.allowanceCredits - row.allowanceUsed);
  const purchasedRemaining = Math.max(0, row.purchasedCredits - row.purchasedUsed);
  // totalRemaining is gross available minus already-reserved-but-not-yet-debited
  const totalRemaining = Math.max(0, allowanceRemaining + purchasedRemaining - row.reservedCredits);
  return { allowanceRemaining, purchasedRemaining, totalRemaining };
}

// ---------------------------------------------------------------------------
// Read balance
// ---------------------------------------------------------------------------

export async function getBucketBalance(teamId: number): Promise<BucketBalance> {
  const [row] = await db
    .select()
    .from(creditBalances)
    .where(eq(creditBalances.teamId, teamId))
    .limit(1);

  if (!row) {
    return {
      allowanceCredits: 0,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      allowanceRemaining: 0,
      purchasedRemaining: 0,
      totalRemaining: 0,
      periodStart: null,
      periodEnd: null,
    };
  }

  const { allowanceRemaining, purchasedRemaining, totalRemaining } = computeRemaining(row);

  return {
    allowanceCredits: row.allowanceCredits,
    purchasedCredits: row.purchasedCredits,
    allowanceUsed: row.allowanceUsed,
    purchasedUsed: row.purchasedUsed,
    reservedCredits: row.reservedCredits,
    allowanceRemaining,
    purchasedRemaining,
    totalRemaining,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

// ---------------------------------------------------------------------------
// Step 1: RESERVE — atomic, blocks if insufficient
// ---------------------------------------------------------------------------

export async function reserveCredits(params: {
  teamId: number;
  operationType: OperationType | string;
  runId: string;
  /** Override cost (e.g. multi-unit articles) */
  amount?: number;
  userId?: number;
}): Promise<ReserveResult> {
  const { teamId, operationType, runId, userId } = params;
  const menuCost = getCreditCost(operationType);
  const amount = params.amount ?? menuCost ?? 0;

  if (amount === 0) {
    // Free operation — no reservation needed
    return { ok: true, runId, requiredCredits: 0, allowanceRemaining: 0, purchasedRemaining: 0, totalRemaining: 0 };
  }

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    await ensureBucketRow(teamId, tx);

    // Read current state
    const [row] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId))
      .limit(1);

    if (!row) throw new Error(`credit_balances row missing for team ${teamId}`);

    const { allowanceRemaining, purchasedRemaining, totalRemaining } = computeRemaining(row);

    if (totalRemaining < amount) {
      return {
        ok: false,
        runId,
        requiredCredits: amount,
        allowanceRemaining,
        purchasedRemaining,
        totalRemaining,
        insufficientBy: amount - totalRemaining,
      };
    }

    // Atomically increment reservedCredits
    const [updated] = await tx
      .update(creditBalances)
      .set({
        reservedCredits: sql`${creditBalances.reservedCredits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning();

    const after = computeRemaining(updated);

    // Insert ledger row (eventType = "reserve")
    await tx.insert(creditLedger).values({
      teamId,
      userId: userId ?? null,
      amount,
      balanceAfter: updated.balance,
      eventType: "reserve",
      operationType,
      runId,
      reason: `Reserve ${amount} credits for ${operationType} (runId: ${runId})`,
    });

    return {
      ok: true,
      runId,
      requiredCredits: amount,
      allowanceRemaining: after.allowanceRemaining,
      purchasedRemaining: after.purchasedRemaining,
      totalRemaining: after.totalRemaining,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 2: DEBIT — converts a reservation into actual usage
// ---------------------------------------------------------------------------

export async function debitReservation(params: {
  teamId: number;
  runId: string;
  userId?: number;
  jobId?: string;
  /**
   * For batch / multi-unit reservations: the portion to debit now.
   * Defaults to the full reservation amount (single-unit jobs).
   */
  amount?: number;
}): Promise<DebitResult> {
  const { teamId, runId, userId, jobId } = params;

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    // Find the matching reservation
    const [reservation] = await tx
      .select()
      .from(creditLedger)
      .where(
        sql`${creditLedger.teamId} = ${teamId} AND ${creditLedger.runId} = ${runId} AND ${creditLedger.eventType} = 'reserve'`
      )
      .limit(1);

    if (!reservation) {
      console.warn(`[billing] No reservation found for runId=${runId} teamId=${teamId} — skipping debit`);
      const balance = await getBucketBalance(teamId);
      return {
        ok: false,
        fromAllowance: 0,
        fromPurchased: 0,
        allowanceRemaining: balance.allowanceRemaining,
        purchasedRemaining: balance.purchasedRemaining,
        totalRemaining: balance.totalRemaining,
      };
    }

    // Support partial debits for batch/multi-unit reservations
    const amount = params.amount ?? reservation.amount;

    // Read current state
    const [row] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId))
      .limit(1);

    if (!row) throw new Error(`credit_balances row missing for team ${teamId}`);

    // Compute bucket split: allowance first, then purchased
    const allowanceAvailable = Math.max(0, row.allowanceCredits - row.allowanceUsed);
    const fromAllowance = Math.min(allowanceAvailable, amount);
    const fromPurchased = amount - fromAllowance;
    const bucket = fromAllowance >= amount ? "allowance" : fromPurchased >= amount ? "purchased" : "mixed";

    // Atomic debit: convert reservation to usage
    const [updated] = await tx
      .update(creditBalances)
      .set({
        allowanceUsed: sql`${creditBalances.allowanceUsed} + ${fromAllowance}`,
        purchasedUsed: sql`${creditBalances.purchasedUsed} + ${fromPurchased}`,
        reservedCredits: sql`GREATEST(${creditBalances.reservedCredits} - ${amount}, 0)`,
        // Keep legacy balance in sync
        balance: sql`GREATEST(${creditBalances.balance} - ${amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning();

    const after = computeRemaining(updated);

    // Insert debit ledger row
    await tx.insert(creditLedger).values({
      teamId,
      userId: userId ?? null,
      amount: -amount,
      balanceAfter: updated.balance,
      eventType: "debit",
      operationType: reservation.operationType,
      runId,
      bucket,
      jobId: jobId ?? null,
      reason: `Debit ${amount} credits for ${reservation.operationType} (runId: ${runId})`,
    });

    return {
      ok: true,
      fromAllowance,
      fromPurchased,
      allowanceRemaining: after.allowanceRemaining,
      purchasedRemaining: after.purchasedRemaining,
      totalRemaining: after.totalRemaining,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 3: RELEASE — cancels a reservation (job failed / cancelled)
// ---------------------------------------------------------------------------

export async function releaseReservation(params: {
  teamId: number;
  runId: string;
  userId?: number;
  reason?: string;
  /**
   * For batch / multi-unit reservations: the portion to release now.
   * Defaults to the full reservation amount (single-unit jobs).
   */
  amount?: number;
}): Promise<void> {
  const { teamId, runId, userId, reason } = params;

  const txDb = await getTxDb();

  await txDb.transaction(async (tx) => {
    // Find the reservation
    const [reservation] = await tx
      .select()
      .from(creditLedger)
      .where(
        sql`${creditLedger.teamId} = ${teamId} AND ${creditLedger.runId} = ${runId} AND ${creditLedger.eventType} = 'reserve'`
      )
      .limit(1);

    if (!reservation) {
      console.warn(`[billing] No reservation found for runId=${runId} teamId=${teamId} — nothing to release`);
      return;
    }

    // Support partial releases for batch/multi-unit reservations
    const amount = params.amount ?? reservation.amount;

    // Release: decrement reservedCredits
    await tx
      .update(creditBalances)
      .set({
        reservedCredits: sql`GREATEST(${creditBalances.reservedCredits} - ${amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId));

    // Insert release ledger row
    await tx.insert(creditLedger).values({
      teamId,
      userId: userId ?? null,
      amount,
      balanceAfter: 0,
      eventType: "release",
      operationType: reservation.operationType,
      runId,
      reason: reason ?? `Release reservation for ${reservation.operationType} (runId: ${runId})`,
    });
  });
}

// ---------------------------------------------------------------------------
// Grant allowance (plan renewal / admin reset)
// ---------------------------------------------------------------------------

export async function grantAllowance(params: {
  teamId: number;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
  adminUserId?: number;
  reason?: string;
  idempotencyKey?: string;
}): Promise<BucketBalance> {
  const { teamId, amount, periodStart, periodEnd, adminUserId, reason, idempotencyKey } = params;

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    // Idempotency
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        const bal = await getBucketBalance(teamId);
        return bal;
      }
    }

    await ensureBucketRow(teamId, tx);

    // Reset allowance bucket; preserve purchased, zero allowanceUsed for new period
    const [updated] = await tx
      .update(creditBalances)
      .set({
        allowanceCredits: amount,
        allowanceUsed: 0,
        periodStart,
        periodEnd,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning();

    await tx.insert(creditLedger).values({
      teamId,
      adminUserId: adminUserId ?? null,
      amount,
      balanceAfter: updated.balance,
      eventType: "grant",
      bucket: "allowance",
      operationType: "plan_renewal",
      idempotencyKey: idempotencyKey ?? null,
      reason: reason ?? `Allowance grant: ${amount} credits for period ${periodStart.toISOString()} – ${periodEnd.toISOString()}`,
    });

    return computeAndReturnBalance(updated);
  });
}

// ---------------------------------------------------------------------------
// Grant purchased top-up credits (never expires, carries forward)
// ---------------------------------------------------------------------------

export async function grantPurchased(params: {
  teamId: number;
  amount: number;
  adminUserId?: number;
  reason?: string;
  idempotencyKey?: string;
}): Promise<BucketBalance> {
  const { teamId, amount, adminUserId, reason, idempotencyKey } = params;

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing) {
        const bal = await getBucketBalance(teamId);
        return bal;
      }
    }

    await ensureBucketRow(teamId, tx);

    const [updated] = await tx
      .update(creditBalances)
      .set({
        purchasedCredits: sql`${creditBalances.purchasedCredits} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning();

    await tx.insert(creditLedger).values({
      teamId,
      adminUserId: adminUserId ?? null,
      amount,
      balanceAfter: updated.balance,
      eventType: "grant",
      bucket: "purchased",
      operationType: "topup",
      idempotencyKey: idempotencyKey ?? null,
      reason: reason ?? `Purchased credit grant: ${amount} credits`,
    });

    return computeAndReturnBalance(updated);
  });
}

// ---------------------------------------------------------------------------
// Admin adjust (manual correction)
// ---------------------------------------------------------------------------

export async function adminAdjust(params: {
  teamId: number;
  bucket: "allowance" | "purchased";
  amount: number; // positive = add, negative = subtract
  adminUserId: number;
  reason: string;
}): Promise<BucketBalance> {
  const { teamId, bucket, amount, adminUserId, reason } = params;

  const txDb = await getTxDb();

  return txDb.transaction(async (tx) => {
    await ensureBucketRow(teamId, tx);

    const col = bucket === "allowance" ? creditBalances.allowanceCredits : creditBalances.purchasedCredits;
    const [updated] = await tx
      .update(creditBalances)
      .set({
        [bucket === "allowance" ? "allowanceCredits" : "purchasedCredits"]:
          sql`GREATEST(${col} + ${amount}, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.teamId, teamId))
      .returning();

    await tx.insert(creditLedger).values({
      teamId,
      adminUserId,
      amount,
      balanceAfter: updated.balance,
      eventType: "adjust",
      bucket,
      operationType: "admin_adjust",
      reason,
    });

    return computeAndReturnBalance(updated);
  });
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function computeAndReturnBalance(row: {
  allowanceCredits: number;
  purchasedCredits: number;
  allowanceUsed: number;
  purchasedUsed: number;
  reservedCredits: number;
  balance: number;
  periodStart: Date | null;
  periodEnd: Date | null;
}): BucketBalance {
  const { allowanceRemaining, purchasedRemaining, totalRemaining } = computeRemaining(row);
  return {
    allowanceCredits: row.allowanceCredits,
    purchasedCredits: row.purchasedCredits,
    allowanceUsed: row.allowanceUsed,
    purchasedUsed: row.purchasedUsed,
    reservedCredits: row.reservedCredits,
    allowanceRemaining,
    purchasedRemaining,
    totalRemaining,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}
