/**
 * Unit tests for the worker execution contract added to createPipelineHandler:
 *   - tenant jobs must resolve a positive teamId and run in tenant context
 *   - system jobs run in system context (audited reason)
 *   - authoritative entity/team cross-check (assertEntityTeam) is fatal and
 *     must NOT release/debit another tenant's reservation on mismatch
 *
 * These tests exercise pure policy — no Redis, no real Worker — via
 * createPipelineHandler + the tenant-context AsyncLocalStorage.
 *
 * Run: WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm --test tests/pipeline/execution-contract.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

after(async () => {
  const { closeDb } = await import("../../lib/db");
  await closeDb();
});

import { UnrecoverableError } from "bullmq";
import {
  assertEntityTeam,
  createPipelineHandler,
  currentTenantTeamId,
  isTenantContextRequiredError,
  isTenantMismatchError,
} from "../../lib/pipeline-worker";
import { getDatabaseExecutionContext } from "../../lib/tenant-context";
import { getRecoveredVideoJobData } from "../../lib/job-recovery";

type AnyJob = any;

function makeJob(data: any = {}): AnyJob {
  return {
    id: "job-1",
    data,
    opts: { attempts: 3 },
    attemptsMade: 0,
  };
}

function releaseSpy() {
  const calls: any[] = [];
  return {
    calls,
    _deps: {
      releaseReservation: async (args: any) => { calls.push(args); },
      recordProviderFailure: async () => {},
    },
  };
}

void test("recovered video jobs carry a verified positive teamId", () => {
  assert.deepEqual(
    getRecoveredVideoJobData({ id: 42, teamId: 7, userId: 11 }),
    { videoIdeaId: 42, teamId: 7, userId: 11 }
  );
  assert.throws(
    () => getRecoveredVideoJobData({ id: 42, teamId: null, userId: 11 }),
    /without a positive teamId/
  );
  assert.throws(
    () => getRecoveredVideoJobData({ id: 42, teamId: 0, userId: 11 }),
    /without a positive teamId/
  );
});

// ── Tenant scope: happy path ────────────────────────────────────────────────
void test("tenant scope runs the processor inside a positive tenant context", async () => {
  let seenScope: string | undefined;
  let seenTeamId: number | undefined;
  const handler = createPipelineHandler(
    "q",
    async () => {
      const ctx = getDatabaseExecutionContext();
      seenScope = ctx?.scope;
      seenTeamId = ctx?.scope === "tenant" ? ctx.teamId : undefined;
      // currentTenantTeamId() must agree with the resolved context.
      assert.equal(currentTenantTeamId(), 42);
      return "ok";
    },
    {
      stage: "text_gen",
      execution: { scope: "tenant", getTeamId: (j: AnyJob) => j.data.teamId },
      _deps: { recordProviderFailure: async () => {} },
    } as any
  );
  const result = await handler(makeJob({ teamId: 42 }));
  assert.equal(result, "ok");
  assert.equal(seenScope, "tenant");
  assert.equal(seenTeamId, 42);
});

void test("legacy owner lookup is system-bounded before tenant processing", async () => {
  let resolverScope: string | undefined;
  let processorScope: string | undefined;
  const handler = createPipelineHandler(
    "legacy-owner",
    async () => {
      const context = getDatabaseExecutionContext();
      processorScope = context?.scope;
      assert.equal(context?.scope, "tenant");
      if (context?.scope === "tenant") assert.equal(context.teamId, 41);
    },
    {
      stage: "text_gen",
      execution: {
        scope: "tenant",
        systemTeamResolutionReason:
          "test legacy durable owner resolution",
        getTeamId: async () => {
          resolverScope = getDatabaseExecutionContext()?.scope;
          return 41;
        },
      },
      _deps: { recordProviderFailure: async () => {} },
    }
  );

  await handler(makeJob());
  assert.equal(resolverScope, "system");
  assert.equal(processorScope, "tenant");
});

// ── Tenant scope: missing/invalid teamId is fatal, no release ───────────────
void test("tenant scope with unresolved teamId fails fatally and never releases", async () => {
  const spy = releaseSpy();
  let processorRan = false;
  const handler = createPipelineHandler(
    "q",
    async () => { processorRan = true; return "unreachable"; },
    {
      stage: "text_gen",
      execution: { scope: "tenant", getTeamId: () => null },
      getBilling: (j: AnyJob) => ({ teamId: j.data.teamId, runId: j.data.creditRunId }),
      _deps: spy._deps,
    } as any
  );
  await assert.rejects(
    () => handler(makeJob({ teamId: undefined, creditRunId: "run-x" })),
    (err: unknown) =>
      err instanceof UnrecoverableError &&
      /TENANT_CONTEXT_REQUIRED/.test((err as Error).message)
  );
  assert.equal(processorRan, false, "processor must never run without a tenant context");
  assert.equal(spy.calls.length, 0, "must not release/debit when the tenant is unresolved");
});

void test("tenant scope with non-positive teamId (0) is fatal and never releases", async () => {
  const spy = releaseSpy();
  const handler = createPipelineHandler(
    "q",
    async () => "unreachable",
    {
      stage: "text_gen",
      execution: { scope: "tenant", getTeamId: () => 0 },
      getBilling: () => ({ teamId: 5, runId: "run-y" }),
      _deps: spy._deps,
    } as any
  );
  await assert.rejects(
    () => handler(makeJob({ creditRunId: "run-y" })),
    (err: unknown) => err instanceof UnrecoverableError
  );
  assert.equal(spy.calls.length, 0);
});

// ── System scope: runs in system context ────────────────────────────────────
void test("system scope runs the processor inside an audited system context", async () => {
  let seenScope: string | undefined;
  let seenReason: string | undefined;
  const handler = createPipelineHandler(
    "sweeper",
    async () => {
      const ctx = getDatabaseExecutionContext();
      seenScope = ctx?.scope;
      seenReason = ctx?.scope === "system" ? ctx.reason : undefined;
      return "swept";
    },
    {
      stage: "scheduler",
      execution: { scope: "system", reason: "test cross-tenant sweep" },
      _deps: { recordProviderFailure: async () => {} },
    } as any
  );
  const result = await handler(makeJob({}));
  assert.equal(result, "swept");
  assert.equal(seenScope, "system");
  assert.equal(seenReason, "test cross-tenant sweep");
});

// ── Entity/team cross-check helper ──────────────────────────────────────────
void test("assertEntityTeam passes when entity team matches job team", () => {
  assert.doesNotThrow(() =>
    assertEntityTeam({ entity: "article", entityId: 1, jobTeamId: 7, entityTeamId: 7 })
  );
});

void test("assertEntityTeam throws TenantMismatchError on differing teams", () => {
  try {
    assertEntityTeam({ entity: "article", entityId: 1, jobTeamId: 7, entityTeamId: 9 });
    assert.fail("expected TenantMismatchError");
  } catch (err) {
    assert.ok(isTenantMismatchError(err), "must be a tenant mismatch");
  }
});

void test("assertEntityTeam treats a missing entity owner as a mismatch", () => {
  try {
    assertEntityTeam({ entity: "article", entityId: 1, jobTeamId: 7, entityTeamId: null });
    assert.fail("expected TenantMismatchError");
  } catch (err) {
    assert.ok(isTenantMismatchError(err));
  }
});

void test("assertEntityTeam rejects a non-positive jobTeamId as a context error", () => {
  try {
    assertEntityTeam({ entity: "article", entityId: 1, jobTeamId: 0, entityTeamId: 0 });
    assert.fail("expected TenantContextRequiredError");
  } catch (err) {
    assert.ok(isTenantContextRequiredError(err));
  }
});

// ── Mismatch inside a processor is fatal and never releases ──────────────────
void test("entity/team mismatch inside a tenant processor is fatal and never releases", async () => {
  const spy = releaseSpy();
  const handler = createPipelineHandler(
    "q",
    async () => {
      // Simulate a processor discovering the entity belongs to another team.
      assertEntityTeam({
        entity: "article",
        entityId: 100,
        jobTeamId: currentTenantTeamId(), // 7
        entityTeamId: 999, // belongs to a different tenant
      });
      return "unreachable";
    },
    {
      stage: "text_gen",
      execution: { scope: "tenant", getTeamId: () => 7 },
      getBilling: () => ({ teamId: 7, runId: "run-z" }),
      _deps: spy._deps,
    } as any
  );
  await assert.rejects(
    () => handler(makeJob({ creditRunId: "run-z" })),
    (err: unknown) =>
      err instanceof UnrecoverableError && /TENANT_MISMATCH/.test((err as Error).message)
  );
  assert.equal(
    spy.calls.length,
    0,
    "a tenant mismatch must NEVER release/debit another tenant's reservation"
  );
});
