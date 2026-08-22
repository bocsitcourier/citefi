/**
 * Reservation State-Machine Tests — Task #118
 * =============================================
 * Verifies the DB-enforced RESERVED → DEBITED | RELEASED state machine that
 * prevents free content on BullMQ retries and double-releases on crashes.
 *
 * Key invariants:
 *  1. Concurrent debit + release → exactly one wins; loser is a no-op.
 *  2. Final-attempt release makes the reservation unreachable by a later debit.
 *  3. Successful retry after a failed attempt debits exactly once.
 *  4. Stale RESERVED rows (>24h) are detectable by the sweeper query.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm \
 *        tests/billing/reservation-state-machine.test.ts
 */

import assert from "node:assert/strict";
import { db } from "../../lib/db.js";
import { reserveCredits, debitReservation, releaseReservation } from "../../lib/billing.js";
import {
  teams,
  users,
  teamMembers,
  creditBalances,
  creditLedger,
} from "../../shared/schema.js";
import { eq, sql, and, inArray } from "drizzle-orm";

// ─── Harness ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ ${name}\n  ${msg}`);
    failures.push(`${name}: ${msg}`);
    failed++;
  }
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

const RUN_TAG = `t118_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
const createdTeamIds: number[] = [];

async function seedTeam(suffix: string, credits = 100): Promise<{ teamId: number; userId: number }> {
  const [userRow] = await db
    .insert(users)
    .values({ email: `t118_${suffix}_${RUN_TAG}@test.invalid`, passwordHash: "x", role: "member", accountStatus: "active" })
    .returning({ id: users.id });

  const [teamRow] = await db
    .insert(teams)
    .values({ name: `T118 ${suffix} ${RUN_TAG}`, createdBy: userRow.id })
    .returning({ id: teams.id });

  await db.insert(teamMembers).values({ teamId: teamRow.id, userId: userRow.id, role: "owner" });

  // Grant credits directly
  await db
    .insert(creditBalances)
    .values({ teamId: teamRow.id, allowanceCredits: credits, purchasedCredits: 0, allowanceUsed: 0, purchasedUsed: 0, reservedCredits: 0, balance: credits })
    .onConflictDoNothing();

  createdTeamIds.push(teamRow.id);
  return { teamId: teamRow.id, userId: userRow.id };
}

async function getReserveRow(teamId: number, runId: string) {
  const [row] = await db
    .select()
    .from(creditLedger)
    .where(and(
      eq(creditLedger.teamId, teamId),
      eq(creditLedger.runId, runId),
      sql`${creditLedger.eventType} = 'reserve'`,
    ))
    .limit(1);
  return row;
}

async function getLedgerEvents(teamId: number, runId: string) {
  return db
    .select({ eventType: creditLedger.eventType })
    .from(creditLedger)
    .where(and(eq(creditLedger.teamId, teamId), eq(creditLedger.runId, runId)));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

await check("reserve() sets reservation_status=RESERVED on the ledger row", async () => {
  const { teamId } = await seedTeam("reserve-basic");
  const runId = `${RUN_TAG}-reserve-basic`;

  await reserveCredits({ teamId, operationType: "article", runId });

  const row = await getReserveRow(teamId, runId);
  assert.ok(row, "reserve ledger row must exist");
  assert.equal(row.reservationStatus, "RESERVED");
});

await check("debit() flips status to DEBITED for a full debit", async () => {
  const { teamId } = await seedTeam("debit-full");
  const runId = `${RUN_TAG}-debit-full`;

  await reserveCredits({ teamId, operationType: "article", runId });
  const result = await debitReservation({ teamId, runId });
  assert.ok(result.ok, "full debit must succeed");

  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "DEBITED");

  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "debit").length, 1, "exactly one debit event");
  assert.equal(events.filter(e => e.eventType === "release").length, 0, "no release events");
});

await check("release() flips status to RELEASED", async () => {
  const { teamId } = await seedTeam("release-basic");
  const runId = `${RUN_TAG}-release-basic`;

  await reserveCredits({ teamId, operationType: "article", runId });
  await releaseReservation({ teamId, runId, reason: "test release" });

  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "RELEASED");

  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "release").length, 1);
  assert.equal(events.filter(e => e.eventType === "debit").length, 0);
});

await check("release() after debit (DEBITED) is a no-op — reservation already charged", async () => {
  const { teamId } = await seedTeam("release-after-debit");
  const runId = `${RUN_TAG}-release-after-debit`;

  await reserveCredits({ teamId, operationType: "article", runId });
  const debitResult = await debitReservation({ teamId, runId });
  assert.ok(debitResult.ok);

  // Simulate pipeline-worker calling release after a successful debit
  // (should be blocked because status is DEBITED)
  await releaseReservation({ teamId, runId, reason: "spurious release" });

  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "release").length, 0, "no release event should be inserted after DEBITED");
  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "DEBITED", "status stays DEBITED");
});

await check("debit() after release (RELEASED) returns ok:false — reservation freed before success", async () => {
  const { teamId } = await seedTeam("debit-after-release");
  const runId = `${RUN_TAG}-debit-after-release`;

  await reserveCredits({ teamId, operationType: "article", runId });
  await releaseReservation({ teamId, runId, reason: "final failure" });

  const debitResult = await debitReservation({ teamId, runId });
  assert.equal(debitResult.ok, false, "debit must fail after release");

  // No debit event should have been inserted
  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "debit").length, 0, "no debit event after RELEASED");
});

await check("concurrent release+debit (sequential simulation) — exactly one wins", async () => {
  const { teamId } = await seedTeam("concurrent");
  const runId = `${RUN_TAG}-concurrent`;

  await reserveCredits({ teamId, operationType: "article", runId });

  // Simulate concurrency by running both in immediate sequence (each grabs the row atomically).
  // In real concurrency both would start, but the CAS guarantees only one succeeds.
  const [releaseResult] = await Promise.allSettled([
    releaseReservation({ teamId, runId, reason: "final failure" }),
    debitReservation({ teamId, runId }),
  ]);

  const events = await getLedgerEvents(teamId, runId);
  const debitCount = events.filter(e => e.eventType === "debit").length;
  const releaseCount = events.filter(e => e.eventType === "release").length;

  // Exactly one of the two settled operations must have written an event
  assert.equal(debitCount + releaseCount, 1, `exactly one event must win; got debit=${debitCount} release=${releaseCount}`);
});

await check("successful retry debits exactly once (idempotent full debit)", async () => {
  const { teamId } = await seedTeam("retry-debit");
  const runId = `${RUN_TAG}-retry-debit`;

  await reserveCredits({ teamId, operationType: "article", runId });

  // Attempt 1 — succeeds
  const first = await debitReservation({ teamId, runId });
  assert.ok(first.ok);

  // Attempt 2 — same runId, no jobId → idempotent via DEBITED status
  const second = await debitReservation({ teamId, runId });
  assert.ok(second.ok, "second call must be idempotent ok:true");

  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "debit").length, 1, "only one debit event even after two calls");
  assert.equal(events.filter(e => e.eventType === "release").length, 0);
});

await check("final-attempt release then retry debit — reservation stays RELEASED", async () => {
  const { teamId } = await seedTeam("final-release-retry");
  const runId = `${RUN_TAG}-final-release-retry`;

  await reserveCredits({ teamId, operationType: "article", runId });

  // Worker fails on attempt 1 → pipeline releases
  await releaseReservation({ teamId, runId, reason: "attempt 1 failed" });

  // A BullMQ retry somehow fires attempt 2 and tries to debit
  const debitResult = await debitReservation({ teamId, runId });
  assert.equal(debitResult.ok, false, "retry debit must fail when reservation is RELEASED");

  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "RELEASED", "status stays RELEASED");
});

await check("release() is idempotent — double release does not double-refund", async () => {
  const { teamId } = await seedTeam("idempotent-release");
  const runId = `${RUN_TAG}-idempotent-release`;

  await reserveCredits({ teamId, operationType: "article", runId });

  await releaseReservation({ teamId, runId, reason: "release 1" });
  await releaseReservation({ teamId, runId, reason: "release 2" });

  const events = await getLedgerEvents(teamId, runId);
  assert.equal(events.filter(e => e.eventType === "release").length, 1, "second release must be a no-op");

  // credit_balances.reservedCredits must be 0, not negative
  const [balance] = await db
    .select({ reservedCredits: creditBalances.reservedCredits })
    .from(creditBalances)
    .where(eq(creditBalances.teamId, teamId))
    .limit(1);
  assert.ok((balance?.reservedCredits ?? 0) >= 0, "reservedCredits must not go negative");
});

await check("batch partial debit (amount < reservation.amount) still works — status stays RESERVED", async () => {
  const { teamId } = await seedTeam("batch-partial", 100);
  const runId = `${RUN_TAG}-batch-partial`;

  // Reserve 100 credits for 10 articles
  await reserveCredits({ teamId, operationType: "article", runId, amount: 100 });

  // Debit 10 credits per article (3 articles)
  const d1 = await debitReservation({ teamId, runId, amount: 10, jobId: "job-1" });
  const d2 = await debitReservation({ teamId, runId, amount: 10, jobId: "job-2" });
  const d3 = await debitReservation({ teamId, runId, amount: 10, jobId: "job-3" });

  assert.ok(d1.ok && d2.ok && d3.ok, "all partial debits must succeed");

  // Reserve row status stays RESERVED so subsequent debits can proceed
  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "RESERVED", "partial debits must not flip status to DEBITED");

  // Release the remaining 70 credits (partial release — amount < reservation.amount of 100).
  // The CAS only fires for full releases to avoid locking out subsequent article debits.
  // Status stays RESERVED; the sweeper will eventually clean up the row once reservedCredits
  // reach zero and the batch is confirmed complete.
  await releaseReservation({ teamId, runId, amount: 70, reason: "end-of-batch", releaseKey: "batch:end" });

  const rowAfter = await getReserveRow(teamId, runId);
  assert.equal(rowAfter?.reservationStatus, "RESERVED", "partial release keeps status RESERVED — sweeper handles cleanup");

  // Verify credit_balances are correct after partial batch completion
  const [balance] = await db
    .select({ reservedCredits: creditBalances.reservedCredits })
    .from(creditBalances)
    .where(eq(creditBalances.teamId, teamId))
    .limit(1);
  // 100 reserved - 30 debited - 70 released = 0 remaining
  assert.equal(balance?.reservedCredits ?? -1, 0, "reservedCredits must be 0 after batch completion");
});

await check("full release of a batch reservation (amount = reservation.amount) flips status to RELEASED", async () => {
  const { teamId } = await seedTeam("batch-full-release", 100);
  const runId = `${RUN_TAG}-batch-full-release`;

  // Reserve 100 credits; no articles succeed → release the entire reservation
  await reserveCredits({ teamId, operationType: "article", runId, amount: 100 });
  await releaseReservation({ teamId, runId, reason: "all articles failed" });

  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "RELEASED", "full release of batch reservation flips status to RELEASED");
});

await check("full debit rolls back DEBITED claim when team reservedCredits is insufficient", async () => {
  // Regression: the DEBITED CAS fires before the credit_balances WHERE guard is checked.
  // If the guard fails (reservedCredits < amount), we must THROW so the transaction rolls
  // back the DEBITED status claim.  A silent ok:false return would strand the reservation
  // as DEBITED with no balance update.
  //
  // Setup: reserve 100 credits, then directly reduce team reservedCredits to 0 to simulate
  // another reservation having consumed the aggregate.  The full debit CAS will claim
  // DEBITED, then the balance guard will fail (0 < 100) → throw → rollback → RESERVED.
  const { teamId } = await seedTeam("debit-guard-rollback", 200);
  const runId = `${RUN_TAG}-debit-guard-rollback`;

  await reserveCredits({ teamId, operationType: "article", runId, amount: 100 });

  // Simulate another reservation consuming the team's full reservedCredits aggregate.
  // We do this directly so there are no debit ledger rows that would trigger pre-lock
  // idempotency checks for this runId.
  await db.execute(
    sql`UPDATE credit_balances SET reserved_credits = 0 WHERE team_id = ${teamId}`
  );

  // Attempt full 100 debit: CAS fires (RESERVED→DEBITED), balance guard fails (0 < 100),
  // throw rolls back the status to RESERVED.
  let threw = false;
  try {
    await debitReservation({ teamId, runId });
  } catch (err) {
    threw = true;
  }
  assert.ok(threw, "debitReservation must throw when balance guard fails after DEBITED CAS");

  // Status must have been rolled back to RESERVED (not permanently stranded as DEBITED)
  const row = await getReserveRow(teamId, runId);
  assert.equal(row?.reservationStatus, "RESERVED", "DEBITED CAS must be rolled back to RESERVED on balance guard failure");

  // Restore reservedCredits so we can verify the reservation is still releaseable
  await db.execute(
    sql`UPDATE credit_balances SET reserved_credits = 100 WHERE team_id = ${teamId}`
  );
  await releaseReservation({ teamId, runId, reason: "test cleanup" });
  const rowAfterRelease = await getReserveRow(teamId, runId);
  assert.equal(rowAfterRelease?.reservationStatus, "RELEASED", "reservation must be releaseable after DEBITED rollback");
});

await check("sweeper query detects RESERVED rows older than 24h", async () => {
  const { teamId } = await seedTeam("sweeper");
  const runId = `${RUN_TAG}-sweeper`;

  await reserveCredits({ teamId, operationType: "article", runId });

  // Artificially back-date the reserve row to 25h ago
  await db.execute(
    sql`UPDATE credit_ledger SET created_at = NOW() - INTERVAL '25 hours'
        WHERE team_id = ${teamId} AND run_id = ${runId} AND event_type = 'reserve'`
  );

  // Run the same query the sweeper uses
  const stale = await db
    .select({ id: creditLedger.id, teamId: creditLedger.teamId, runId: creditLedger.runId, amount: creditLedger.amount })
    .from(creditLedger)
    .where(
      sql`${creditLedger.eventType} = 'reserve'
        AND ${creditLedger.reservationStatus} = 'RESERVED'
        AND ${creditLedger.createdAt} < NOW() - INTERVAL '24 hours'
        AND ${creditLedger.teamId} = ${teamId}`
    );

  assert.ok(stale.length > 0, "sweeper query must find the backdated RESERVED row");
  assert.equal(stale[0]!.runId, runId);
});

// ─── Cleanup ─────────────────────────────────────────────────────────────────

try {
  if (createdTeamIds.length > 0) {
    // Use inArray() rather than raw ANY() — the Neon HTTP driver requires
    // array parameters to be wrapped as a typed SQL array, but inArray()
    // emits a plain IN (...) list that works reliably with both drivers.
    await db.delete(creditLedger).where(inArray(creditLedger.teamId, createdTeamIds));
    await db.delete(creditBalances).where(inArray(creditBalances.teamId, createdTeamIds));
    await db.delete(teamMembers).where(inArray(teamMembers.teamId, createdTeamIds));
    await db.delete(teams).where(inArray(teams.id, createdTeamIds));
  }
} catch (err) {
  console.warn("Cleanup error (non-fatal):", err instanceof Error ? err.message : err);
} finally {
  const { closeDb } = await import("../../lib/db.js");
  await closeDb();
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\nReservation state-machine checks: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.error("Failed tests:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
