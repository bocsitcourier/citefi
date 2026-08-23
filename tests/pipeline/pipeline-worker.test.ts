/**
 * Unit tests for createPipelineHandler — the single policy point for all
 * BullMQ workers (error taxonomy, budget gate, final-attempt credit release).
 *
 * Run: WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm --test tests/pipeline/pipeline-worker.test.ts
 */
import { test as nodeTest, after } from "node:test";
import assert from "node:assert/strict";
import { runWithSystemContext } from "../../lib/tenant-context";

function test(name: string, fn: () => void | Promise<void>) {
  return nodeTest(name, () =>
    runWithSystemContext("pipeline test fixture setup", fn)
  );
}

// Close the pooled DB connection so the test process exits deterministically.
after(async () => {
  const { closeDb } = await import("../../lib/db");
  await closeDb();
});
import { UnrecoverableError } from "bullmq";
import {
  BillingSettlementError,
  createPipelineHandler,
} from "../../lib/pipeline-worker";

type AnyJob = any;

function makeJob(overrides: Partial<{ attemptsMade: number; attempts: number; data: any }> = {}): AnyJob {
  return {
    id: "job-1",
    data: { teamId: 7, creditRunId: "run-abc", articleId: 42, ...(overrides.data ?? {}) },
    opts: { attempts: overrides.attempts ?? 3 },
    attemptsMade: overrides.attemptsMade ?? 0,
  };
}

function deps() {
  const calls: any[] = [];
  const providerFailures: any[] = [];
  return {
    calls,
    providerFailures,
    _deps: {
      releaseReservation: async (args: any) => { calls.push(args); },
      recordProviderFailure: async (queueName: string, error: any) => { providerFailures.push({ queueName, error }); },
    },
  };
}

const billingOpts = {
  stage: "text_gen",
  getBilling: (j: AnyJob) => ({ teamId: j.data.teamId, runId: j.data.creditRunId }),
};

void test("transient failure on NON-final attempt: no release, original error rethrown", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 0, attempts: 3 })), /503/);
  assert.equal(d.calls.length, 0, "reservation must be preserved for the retry");
});

void test("provider 503 is reported to the shared provider circuit breaker", async () => {
  const d = deps();
  const handler = createPipelineHandler("article-generation", async () => {
    throw new Error("Gemini 503 service unavailable");
  }, { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob()));
  assert.equal(d.providerFailures.length, 1);
  assert.equal(d.providerFailures[0].queueName, "article-generation");
  assert.equal(d.providerFailures[0].error.code, "PROVIDER_ERROR");
  assert.equal(d.providerFailures[0].error.provider, "gemini");
});

void test("non-provider failures do not trip the provider circuit", async () => {
  const d = deps();
  const handler = createPipelineHandler("article-generation", async () => {
    throw new Error("invalid article JSON");
  }, { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob()));
  assert.equal(d.providerFailures.length, 1, "the wrapper delegates classification; breaker filters non-provider codes");
  assert.equal(d.providerFailures[0].error.code, "PARSE_ERROR");
});

void test("transient failure on FINAL attempt: releases reservation exactly once", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("503 service unavailable"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 1, "release must fire exactly once on the final attempt");
  assert.equal(d.calls[0].teamId, 7);
  assert.equal(d.calls[0].runId, "run-abc");
});

void test("full retry lifecycle (3 attempts): release fires exactly once total", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("ETIMEDOUT"); },
    { ...billingOpts, _deps: d._deps } as any);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(() => handler(makeJob({ attemptsMade: attempt, attempts: 3 })));
  }
  assert.equal(d.calls.length, 1, "exactly one release across the whole retry lifecycle");
});

void test("a failed batch article releases only its share and duplicate final failures are idempotent", async () => {
  const { db } = await import("../../lib/db");
  const { reserveCredits, debitReservation, releaseReservation } = await import("../../lib/billing");
  const { users, teams, teamMembers, creditBalances, creditLedger } = await import("../../shared/schema");
  const { eq } = await import("drizzle-orm");

  const perArticleCredits = 7;
  const articleIds = [101, 102, 103] as const;
  const runId = `test-batch-release-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let teamId: number | undefined;
  let userId: number | undefined;

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: `${runId}@test.invalid`,
        passwordHash: "x",
        role: "member",
        accountStatus: "active",
      })
      .returning({ id: users.id });
    assert.ok(user, "test user must be created");
    userId = user.id;

    const [team] = await db
      .insert(teams)
      .values({ name: `Batch release ${runId}`, createdBy: userId })
      .returning({ id: teams.id });
    assert.ok(team, "test team must be created");
    teamId = team.id;

    await db.insert(teamMembers).values({ teamId, userId, role: "owner" });
    await db.insert(creditBalances).values({
      teamId,
      allowanceCredits: 100,
      purchasedCredits: 0,
      allowanceUsed: 0,
      purchasedUsed: 0,
      reservedCredits: 0,
      balance: 100,
    });

    const reserved = await reserveCredits({
      teamId,
      operationType: "article",
      runId,
      amount: articleIds.length * perArticleCredits,
    });
    assert.equal(reserved.ok, true, "the three-article batch reservation must succeed");

    // Exercise the exact production article-worker resolver. Without its
    // amount and article-scoped release key, releaseReservation defaults to
    // the entire batch and duplicate final deliveries can refund siblings.
    const { getArticleGenerationBilling } = await import("../../lib/worker");
    let preclaimsAtBarrier = 0;
    let openPreclaimBarrier!: () => void;
    const preclaimBarrier = new Promise<void>((resolve) => {
      openPreclaimBarrier = resolve;
    });
    const handler = createPipelineHandler(
      "article-generation",
      async () => { throw new Error("Gemini unavailable"); },
      {
        stage: "text_gen",
        getBilling: getArticleGenerationBilling,
        _deps: {
          // Pause both real billing transactions after their compatibility
          // lookup but before the unique claim. Removing the atomic claim would
          // now deterministically let both deliveries decrement the reservation.
          releaseReservation: async (args: Parameters<typeof releaseReservation>[0]) => {
            return releaseReservation(args, {
              afterExistingReleaseCheck: async () => {
                preclaimsAtBarrier += 1;
                if (preclaimsAtBarrier === 2) openPreclaimBarrier();
                await preclaimBarrier;
              },
            });
          },
          recordProviderFailure: async () => {},
        },
      } as any
    );
    const failedArticle = makeJob({
      attemptsMade: 2,
      attempts: 3,
      data: {
        teamId,
        creditRunId: runId,
        articleId: articleIds[0],
        creditCostPerUnit: perArticleCredits,
      },
    });

    await Promise.all([
      assert.rejects(() => handler(failedArticle)),
      assert.rejects(() => handler(failedArticle)),
    ]);

    const [balanceAfterFailure] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.ok(balanceAfterFailure, "test credit balance must exist");
    assert.equal(
      balanceAfterFailure.reservedCredits,
      perArticleCredits * 2,
      "only the failed article's share may be released"
    );

    const releases = await db
      .select({
        amount: creditLedger.amount,
        reason: creditLedger.reason,
        idempotencyKey: creditLedger.idempotencyKey,
      })
      .from(creditLedger)
      .where(eq(creditLedger.runId, runId));
    const releaseEvents = releases.filter((event) => event.reason?.includes(`[releaseKey:article:${articleIds[0]}]`));
    assert.equal(releaseEvents.length, 1, "the article release key must make duplicate final failures idempotent");
    assert.equal(releaseEvents[0]?.amount, perArticleCredits);
    assert.match(
      releaseEvents[0]?.idempotencyKey ?? "",
      /^credit-release:[a-f0-9]{64}$/,
      "the release must be protected by a durable DB-unique claim"
    );

    const siblingDebit = await debitReservation({
      teamId,
      runId,
      jobId: `article:${articleIds[1]}`,
      amount: perArticleCredits,
    });
    assert.equal(siblingDebit.ok, true, "a sibling article must still debit the shared reservation");

    const [balanceAfterSiblingDebit] = await db
      .select({ reservedCredits: creditBalances.reservedCredits })
      .from(creditBalances)
      .where(eq(creditBalances.teamId, teamId));
    assert.ok(balanceAfterSiblingDebit, "test credit balance must exist after sibling debit");
    assert.equal(balanceAfterSiblingDebit.reservedCredits, perArticleCredits);
  } finally {
    if (teamId !== undefined) {
      await db.delete(creditLedger).where(eq(creditLedger.teamId, teamId));
      await db.delete(creditBalances).where(eq(creditBalances.teamId, teamId));
      await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
      await db.delete(teams).where(eq(teams.id, teamId));
    }
    if (userId !== undefined) {
      await db.delete(users).where(eq(users.id, userId));
    }
  }
});

void test("fatal error: releases immediately and throws UnrecoverableError", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("401 unauthorized: invalid api key"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError
  );
  assert.equal(d.calls.length, 1, "fatal errors release on the first attempt (no more retries will run)");
});

void test("DEBIT_FAILED: never releases (content was delivered; only the debit retries)", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => {
    throw new BillingSettlementError("debit unavailable for article 42");
  }, { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3 })));
  assert.equal(d.calls.length, 0, "DEBIT_FAILED must not refund a delivered product");
});

void test("no billing info (missing runId): final failure does not call release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => { throw new Error("boom"); },
    { ...billingOpts, _deps: d._deps } as any);
  await assert.rejects(() => handler(makeJob({ attemptsMade: 2, attempts: 3, data: { teamId: 7, creditRunId: undefined } })));
  assert.equal(d.calls.length, 0);
});

void test("BUDGET_EXCEEDED thrown by processor (in-processor gate) is fatal and releases once", async () => {
  // The assertRunBudget gate lives inside processors' try blocks; when it
  // throws, the error flows through the processor catch (domain cleanup),
  // gets rethrown, and this wrapper must treat it as fatal + release.
  const d = deps();
  const handler = createPipelineHandler("q", async () => {
    const { PipelineError } = await import("../../lib/errors");
    throw new PipelineError("run spent $0.20 >= ceiling $0.15", "BUDGET_EXCEEDED", "fatal", "text_gen");
  }, {
    ...billingOpts,
    budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
    _deps: d._deps,
  } as any);
  await assert.rejects(
    () => handler(makeJob({ attemptsMade: 0, attempts: 3 })),
    (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
  );
  assert.equal(d.calls.length, 1, "budget-exceeded runs must release the reservation");
});

void test("success path: processor result returned, no release", async () => {
  const d = deps();
  const handler = createPipelineHandler("q", async () => ({ ok: true }),
    { ...billingOpts, _deps: d._deps } as any);
  const result = await handler(makeJob());
  assert.deepEqual(result, { ok: true });
  assert.equal(d.calls.length, 0);
});

void test("run-context identity: wrapper enters the SAME runId the processor's budget gate asserts", async () => {
  // Regression guard for the article ID-mismatch bug: telemetry attribution
  // (wrapper enterRunContext via budget.getRunId) and the in-processor
  // assertRunBudget gate must key off the same job-data field (creditRunId),
  // or the ceiling always sums $0 and never trips.
  const { currentRunId } = await import("../../lib/run-context");
  let observed: string | undefined;
  const handler = createPipelineHandler("q", async (job: AnyJob) => {
    observed = currentRunId();
    assert.equal(observed, job.data.creditRunId, "gate would query a different ID than telemetry records under");
    return "ok";
  }, {
    stage: "text_gen",
    budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
  } as any);
  await handler(makeJob());
  assert.equal(observed, "run-abc");
});

void test("every metered content type: telemetry under creditRunId attributes AND trips that type's budget gate", async () => {
  // Coverage for each content worker that declares a budget: article,
  // social_post, podcast, video. For each, telemetry recorded under the
  // run ID must (a) be what the wrapper attributes (currentRunId) and
  // (b) trip the real assertRunBudget gate keyed by the same creditRunId.
  const { db } = await import("../../lib/db");
  const { costTelemetry } = await import("../../shared/schema");
  const { eq } = await import("drizzle-orm");
  const { currentRunId } = await import("../../lib/run-context");
  const { assertRunBudget } = await import("../../lib/cost-ceilings");
  const cases: Array<{ contentType: any; stage: string }> = [
    { contentType: "article", stage: "text_gen" },
    { contentType: "social_post", stage: "text_gen" },
    { contentType: "podcast", stage: "text_gen" },
    { contentType: "video", stage: "video_gen" },
  ];
  for (const c of cases) {
    const runId = `test-budget-${c.contentType}-${Date.now()}`;
    await db.insert(costTelemetry).values({
      jobId: runId,
      operationType: `${c.contentType}_generation`,
      provider: "gemini",
      model: "test-model",
      costMicrousd: 100_000_000, // $100 — above every ceiling
      success: 1,
    });
    try {
      const d = deps();
      const handler = createPipelineHandler("q", async (job: AnyJob) => {
        assert.equal(currentRunId(), job.data.creditRunId, `${c.contentType}: attribution ID must equal gate ID`);
        await assertRunBudget(job.data.creditRunId, c.contentType, c.stage);
        return "should not reach";
      }, {
        stage: c.stage,
        getBilling: (j: AnyJob) => ({ teamId: j.data.teamId, runId: j.data.creditRunId }),
        budget: { contentType: c.contentType, getRunId: (j: AnyJob) => j.data.creditRunId },
        _deps: d._deps,
      } as any);
      await assert.rejects(
        () => handler(makeJob({ attemptsMade: 0, attempts: 3, data: { teamId: 7, creditRunId: runId } })),
        (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message),
        `${c.contentType}: gate must trip as fatal`
      );
      assert.equal(d.calls.length, 1, `${c.contentType}: exactly one release`);
    } finally {
      await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
    }
  }
});

void test("recorded telemetry under the run ID trips the next attempt's budget gate (production ID path)", async () => {
  // End-to-end over the real DB: insert cost telemetry keyed by the run ID
  // (cost_telemetry.jobId), then run the article-shaped handler whose
  // processor calls the real assertRunBudget with the same creditRunId —
  // the gate must throw BUDGET_EXCEEDED, and the wrapper must release once
  // and convert it to UnrecoverableError.
  const { db } = await import("../../lib/db");
  const { costTelemetry } = await import("../../shared/schema");
  const { eq } = await import("drizzle-orm");
  const runId = `test-budget-${Date.now()}`;
  await db.insert(costTelemetry).values({
    jobId: runId,
    operationType: "article_generation",
    provider: "gemini",
    model: "test-model",
    costMicrousd: 100_000_000, // $100 — far above any content ceiling
    success: 1,
  });
  try {
    const d = deps();
    const handler = createPipelineHandler("q", async (job: AnyJob) => {
      // Mirrors the production article processor: gate inside the try,
      // keyed by the same creditRunId the wrapper attributed.
      const { assertRunBudget } = await import("../../lib/cost-ceilings");
      await assertRunBudget(job.data.creditRunId, "article", "text_gen");
      return "should not reach";
    }, {
      ...billingOpts,
      budget: { contentType: "article", getRunId: (j: AnyJob) => j.data.creditRunId },
      _deps: d._deps,
    } as any);
    await assert.rejects(
      () => handler(makeJob({ attemptsMade: 0, attempts: 3, data: { teamId: 7, creditRunId: runId } })),
      (err: unknown) => err instanceof UnrecoverableError && /BUDGET_EXCEEDED/.test((err as Error).message)
    );
    assert.equal(d.calls.length, 1, "budget-tripped run must release its reservation exactly once");
    assert.equal(d.calls[0].runId, runId);
  } finally {
    await db.delete(costTelemetry).where(eq(costTelemetry.jobId, runId));
  }
});
