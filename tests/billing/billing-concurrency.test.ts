/**
 * Billing Concurrency Tests
 * =========================
 * Validates that concurrent debitReservation() calls correctly serialise
 * bucket-split computation via the SELECT ... FOR UPDATE lock, so allowance
 * is exhausted first and purchased credits are only consumed after allowance
 * runs out — even when multiple batch-article workers race.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/billing/billing-concurrency.test.ts
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/db.js";
import { debitReservation, getBucketBalance } from "../../lib/billing.js";
import {
  teams,
  users,
  teamMembers,
  creditBalances,
  creditLedger,
} from "../../shared/schema.js";
import { eq, inArray } from "drizzle-orm";

const RUN_ID = `billing_conc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface SeedResult {
  teamId: number;
  userId: number;
}

async function seedBillingTeam(tag: string): Promise<SeedResult> {
  // Minimal user + team needed so FK constraints are satisfied
  const [userRow] = await db
    .insert(users)
    .values({
      email: `billing_test_${tag}_${RUN_ID}@test.invalid`,
      passwordHash: "not-used",
      role: "member",
      accountStatus: "active",
    })
    .returning({ id: users.id });

  const [teamRow] = await db
    .insert(teams)
    .values({ name: `BillingTest ${tag} ${RUN_ID}`, createdBy: userRow.id })
    .returning({ id: teams.id });

  await db.insert(teamMembers).values({
    teamId: teamRow.id,
    userId: userRow.id,
    role: "owner",
  });

  return { teamId: teamRow.id, userId: userRow.id };
}

async function seedCreditBalance(
  teamId: number,
  allowanceCredits: number,
  purchasedCredits: number,
  reservedCredits: number
): Promise<void> {
  const balance = allowanceCredits + purchasedCredits;
  await db.insert(creditBalances).values({
    teamId,
    balance,
    allowanceCredits,
    purchasedCredits,
    allowanceUsed: 0,
    purchasedUsed: 0,
    reservedCredits,
  });
}

async function seedReservation(
  teamId: number,
  runId: string,
  amount: number
): Promise<void> {
  await db.insert(creditLedger).values({
    teamId,
    amount,
    balanceAfter: 0,
    eventType: "reserve",
    operationType: "article",
    runId,
    reason: `Test reservation for ${amount} credits`,
  });
}

async function cleanupBillingTeam(teamId: number, userId: number): Promise<void> {
  // cascades handle creditBalances, creditLedger, teamMembers
  await db.delete(teams).where(eq(teams.id, teamId));
  await db.delete(users).where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("debitReservation — concurrent batch workers", () => {
  // Scenario A: 5 concurrent debits × 10 credits
  //   allowance=30, purchased=40, reserved=50
  //   Expected final: allowanceUsed=30, purchasedUsed=20, reserved=0
  test("5 concurrent debits correctly exhaust allowance first, then purchased", async () => {
    const { teamId, userId } = await seedBillingTeam("scenA");
    const runId = `${RUN_ID}_scen_a`;
    try {
      await seedCreditBalance(teamId, 30, 40, 50);
      await seedReservation(teamId, runId, 50);

      const results = await Promise.all([
        debitReservation({ teamId, runId, jobId: `${runId}_j1`, amount: 10 }),
        debitReservation({ teamId, runId, jobId: `${runId}_j2`, amount: 10 }),
        debitReservation({ teamId, runId, jobId: `${runId}_j3`, amount: 10 }),
        debitReservation({ teamId, runId, jobId: `${runId}_j4`, amount: 10 }),
        debitReservation({ teamId, runId, jobId: `${runId}_j5`, amount: 10 }),
      ]);

      // All debits must succeed
      for (let i = 0; i < results.length; i++) {
        assert.equal(results[i].ok, true, `debit ${i + 1} should succeed`);
      }

      // Total deducted must match reservation
      const totalFromAllowance = results.reduce((s, r) => s + r.fromAllowance, 0);
      const totalFromPurchased = results.reduce((s, r) => s + r.fromPurchased, 0);
      assert.equal(totalFromAllowance + totalFromPurchased, 50, "total deducted must equal reservation");

      // Final ledger state
      const final = await getBucketBalance(teamId);
      assert.equal(final.allowanceUsed, 30, "all allowance should be consumed");
      assert.equal(final.purchasedUsed, 20, "remainder (20) taken from purchased");
      assert.equal(final.reservedCredits, 0, "reservation fully consumed");
      assert.equal(final.allowanceRemaining, 0, "no allowance left");
      assert.equal(final.purchasedRemaining, 20, "20 purchased credits remain");
    } finally {
      await cleanupBillingTeam(teamId, userId);
    }
  });

  // Scenario B: 2 concurrent debits × 15 credits each
  //   allowance=10, purchased=30, reserved=30
  //   Expected: allowanceUsed=10, purchasedUsed=20, reserved=0
  //   (first debit should be mixed: 10 allowance + 5 purchased; second: 0 allowance + 15 purchased)
  test("2 concurrent debits with mixed allowance+purchased split are correctly attributed", async () => {
    const { teamId, userId } = await seedBillingTeam("scenB");
    const runId = `${RUN_ID}_scen_b`;
    try {
      await seedCreditBalance(teamId, 10, 30, 30);
      await seedReservation(teamId, runId, 30);

      const [r1, r2] = await Promise.all([
        debitReservation({ teamId, runId, jobId: `${runId}_j1`, amount: 15 }),
        debitReservation({ teamId, runId, jobId: `${runId}_j2`, amount: 15 }),
      ]);

      assert.equal(r1.ok, true, "debit 1 should succeed");
      assert.equal(r2.ok, true, "debit 2 should succeed");

      // Combined attribution must be correct — order of workers may vary
      const totalFromAllowance = r1.fromAllowance + r2.fromAllowance;
      const totalFromPurchased = r1.fromPurchased + r2.fromPurchased;
      assert.equal(totalFromAllowance, 10, "exactly 10 credits from allowance");
      assert.equal(totalFromPurchased, 20, "exactly 20 credits from purchased");

      const final = await getBucketBalance(teamId);
      assert.equal(final.allowanceUsed, 10, "allowance fully consumed");
      assert.equal(final.purchasedUsed, 20, "purchased consumed for remainder");
      assert.equal(final.reservedCredits, 0, "reservation fully consumed");

      // Invariant: no bucket exceeds its limit
      assert.ok(
        final.allowanceUsed <= 10,
        `allowanceUsed(${final.allowanceUsed}) must not exceed allowanceCredits(10)`
      );
      assert.ok(
        final.purchasedUsed <= 30,
        `purchasedUsed(${final.purchasedUsed}) must not exceed purchasedCredits(30)`
      );
    } finally {
      await cleanupBillingTeam(teamId, userId);
    }
  });

  // Scenario C: idempotency — duplicate jobId debits must not double-debit
  test("duplicate debit with same jobId is idempotent", async () => {
    const { teamId, userId } = await seedBillingTeam("scenC");
    const runId = `${RUN_ID}_scen_c`;
    try {
      await seedCreditBalance(teamId, 50, 0, 10);
      await seedReservation(teamId, runId, 10);

      const jobId = `${runId}_j1`;
      const r1 = await debitReservation({ teamId, runId, jobId, amount: 10 });
      const r2 = await debitReservation({ teamId, runId, jobId, amount: 10 });

      assert.equal(r1.ok, true, "first debit should succeed");
      assert.equal(r2.ok, true, "duplicate debit should return ok:true idempotently");

      const final = await getBucketBalance(teamId);
      // Must only have debited ONCE (10 credits)
      assert.equal(final.allowanceUsed, 10, "should only have debited 10 credits once");
      assert.equal(final.purchasedUsed, 0, "purchased should not be touched");
    } finally {
      await cleanupBillingTeam(teamId, userId);
    }
  });
});
