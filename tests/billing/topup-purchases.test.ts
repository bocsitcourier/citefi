/**
 * Credit top-up purchase tests
 * ============================
 * Verifies the Stripe webhook's accounting primitive: a Checkout Session can
 * be delivered more than once without minting extra credits, and the granted
 * credits immediately pass the team paywall.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/billing/topup-purchases.test.ts
 */
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { getTxDb } from "../../lib/db.js";
import { grantPurchased, getBucketBalance } from "../../lib/billing.js";
import { checkTeamPaywall } from "../../lib/billing/paywall.js";
import { TOP_UPS } from "../../lib/billing/plans.js";
import { creditBalances, creditLedger, teamMembers, teams, users } from "../../shared/schema.js";

const RUN_ID = `topup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const txDb = getTxDb();
let teamId: number | undefined;
let userId: number | undefined;

after(async () => {
  if (teamId) await txDb.delete(teams).where(eq(teams.id, teamId));
  if (userId) await txDb.delete(users).where(eq(users.id, userId));
});

describe("credit top-up purchases", () => {
  test("offers the requested fixed packs", () => {
    assert.deepEqual(
      TOP_UPS.map((pack) => ({ id: pack.id, priceUsd: pack.priceUsd })),
      [
        { id: "topup_5", priceUsd: 5 },
        { id: "topup_10", priceUsd: 10 },
        { id: "topup_25", priceUsd: 25 },
      ]
    );
  });

  test("credits a checkout session once and unblocks an expired trial", async () => {
    const [user] = await txDb
      .insert(users)
      .values({
        email: `topup_${RUN_ID}@test.invalid`,
        passwordHash: "not-used",
        role: "member",
        accountStatus: "active",
      })
      .returning({ id: users.id });
    userId = user!.id;

    const [team] = await txDb
      .insert(teams)
      .values({ name: `Top-up test ${RUN_ID}`, createdBy: userId })
      .returning({ id: teams.id });
    teamId = team!.id;

    await txDb.insert(teamMembers).values({ teamId, userId, role: "owner" });
    await txDb
      .update(teams)
      .set({
        billingStatus: "trialing",
        currentPeriodEnd: new Date(Date.now() - 60_000),
      })
      .where(eq(teams.id, teamId));

    const pack = TOP_UPS[0]!;
    const idempotencyKey = `topup-cs_${RUN_ID}`;
    await grantPurchased({
      teamId,
      amount: pack.credits,
      idempotencyKey,
      reason: `Top-up: ${pack.label} ($${pack.priceUsd})`,
    });
    await grantPurchased({
      teamId,
      amount: pack.credits,
      idempotencyKey,
      reason: `Top-up: ${pack.label} ($${pack.priceUsd})`,
    });

    const [balance, paywall, [legacyRow], ledger] = await Promise.all([
      getBucketBalance(teamId),
      checkTeamPaywall(teamId),
      txDb.select({ balance: creditBalances.balance }).from(creditBalances).where(eq(creditBalances.teamId, teamId)),
      txDb.select({ id: creditLedger.id }).from(creditLedger).where(eq(creditLedger.idempotencyKey, idempotencyKey)),
    ]);

    assert.equal(balance.purchasedCredits, pack.credits);
    assert.equal(balance.purchasedRemaining, pack.credits);
    assert.equal(legacyRow!.balance, pack.credits, "legacy balance stays in sync for older consumers");
    assert.equal(ledger.length, 1, "the Checkout Session creates exactly one ledger grant");
    assert.equal(paywall.allowed, true);
    assert.equal(paywall.creditBalance, pack.credits);
  });
});