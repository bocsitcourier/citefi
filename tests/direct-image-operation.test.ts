import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const { ProviderResultNotDurableError } = await import("../lib/cost-telemetry");
const {
  DirectImageOperationError,
  directImageRunId,
  runDirectImageOperation,
} = await import("../lib/direct-image-operation");

type FakeState = {
  flagged: boolean;
  held?: boolean;
  released?: number;
  marked?: number;
  debitOk?: boolean;
  reserveOk?: boolean;
  claimed?: boolean;
};

function fakeDeps(state: FakeState) {
  return {
    assertNoUnresolvedAttempt: async () => {
      if (state.flagged) {
        throw new DirectImageOperationError(
          "prior unresolved attempt",
          409,
          "RECONCILIATION_REQUIRED",
        );
      }
    },
    resolveRunId: async () => `fake-run-after-${state.released ?? 0}`,
    getCreditCost: async () => 1,
    checkCap: async () => 17,
    reserve: async ({ runId }: { runId: string }) => {
      state.held = state.reserveOk !== false;
      return {
        ok: state.reserveOk !== false,
        runId,
        requiredCredits: 1,
        allowanceRemaining: 9,
        purchasedRemaining: 0,
        totalRemaining: 9,
      };
    },
    claimProviderEntry: async () => {
      if (state.claimed) return false;
      state.claimed = true;
      state.flagged = true;
      return true;
    },
    clearOwnedProviderEntryFlag: async () => {
      if (!state.claimed || !state.flagged) return false;
      state.flagged = false;
      return true;
    },
    release: async () => {
      state.released = (state.released ?? 0) + 1;
      state.held = false;
      state.claimed = false;
    },
    markReconciliation: async () => {
      state.marked = (state.marked ?? 0) + 1;
      state.flagged = true;
      return true;
    },
    debit: async () => ({
      ok: state.debitOk !== false,
      fromAllowance: 1,
      fromPurchased: 0,
      allowanceRemaining: 8,
      purchasedRemaining: 0,
      totalRemaining: 8,
    }),
    recordUsage: async () => undefined,
    cancelCap: async () => undefined,
  } as any;
}

void test("ambiguous direct image attempt keeps hold and blocks a second physical call", async () => {
  const state: FakeState = { flagged: false };
  const deps = fakeDeps(state);
  let physicalCalls = 0;
  const invoke = () => runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "article_hero",
    resourceId: 42,
    resourceVersion: "old-url",
    generate: async () => {
      physicalCalls++;
      throw new ProviderResultNotDurableError("fake provider success lost", "fake-1");
    },
    persist: async () => "unused",
    _deps: deps,
  });

  await assert.rejects(invoke, (error: any) => error?.code === "PROVIDER_RESULT_NOT_DURABLE");
  await assert.rejects(invoke, (error: any) => error?.code === "RECONCILIATION_REQUIRED");
  assert.equal(physicalCalls, 1);
  assert.equal(state.marked, 1);
  assert.equal(state.released ?? 0, 0);
  assert.equal(state.held, true);
});

void test("storage failure after provider bytes blocks replay without refund", async () => {
  const state: FakeState = { flagged: false };
  let physicalCalls = 0;
  let storageCalls = 0;
  const invoke = () => runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "media_asset",
    resourceId: 9,
    resourceVersion: "old-url",
    generate: async () => {
      physicalCalls++;
      return Buffer.from("image");
    },
    persist: async () => {
      storageCalls++;
      throw new Error("fake storage outage");
    },
    _deps: fakeDeps(state),
  });

  await assert.rejects(invoke, /fake storage outage/);
  await assert.rejects(invoke, (error: any) => error?.code === "RECONCILIATION_REQUIRED");
  assert.equal(physicalCalls, 1);
  assert.equal(storageCalls, 1);
  assert.equal(state.released ?? 0, 0);
});

void test("delivered image with failed debit is flagged and cannot regenerate", async () => {
  const state: FakeState = { flagged: false, debitOk: false };
  let physicalCalls = 0;
  let dbLinks = 0;
  const invoke = () => runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "article_hero",
    resourceId: 5,
    resourceVersion: "old-url",
    generate: async () => {
      physicalCalls++;
      return "bytes";
    },
    persist: async () => {
      dbLinks++;
      return "new-url";
    },
    _deps: fakeDeps(state),
  });

  await assert.rejects(invoke, (error: any) => error?.code === "BILLING_RECONCILIATION_REQUIRED");
  await assert.rejects(invoke, (error: any) => error?.code === "RECONCILIATION_REQUIRED");
  assert.equal(physicalCalls, 1);
  assert.equal(dbLinks, 1);
  assert.equal(state.released ?? 0, 0);
});

void test("credit rejection prevents provider entry and stable identity is tenant-resource scoped", async () => {
  const state: FakeState = { flagged: false, reserveOk: false };
  let physicalCalls = 0;
  await assert.rejects(
    () => runDirectImageOperation({
      teamId: 7,
      userId: 11,
      resourceType: "media_asset",
      resourceId: 9,
      resourceVersion: "v1",
      generate: async () => {
        physicalCalls++;
        return "bytes";
      },
      persist: async () => "url",
      _deps: fakeDeps(state),
    }),
    (error: any) => error?.code === "CREDITS_EXHAUSTED" && error?.statusCode === 402,
  );
  assert.equal(physicalCalls, 0);
  assert.equal(
    directImageRunId({ resourceType: "media_asset", resourceId: 9, resourceVersion: "v1" }),
    directImageRunId({ resourceType: "media_asset", resourceId: 9, resourceVersion: "v1" }),
  );
  assert.equal(
    directImageRunId({ resourceType: "media_asset", resourceId: 9, resourceVersion: "v1", requestKey: "caller-a" }),
    directImageRunId({ resourceType: "media_asset", resourceId: 9, resourceVersion: "v1", requestKey: "caller-b" }),
  );
  assert.notEqual(
    directImageRunId({ resourceType: "media_asset", resourceId: 9, resourceVersion: "v1" }),
    directImageRunId({ resourceType: "media_asset", resourceId: 10, resourceVersion: "v1" }),
  );
});

void test("simultaneous same-resource calls atomically admit one provider submission", async () => {
  const state: FakeState = { flagged: false };
  const deps = fakeDeps(state);
  let physicalCalls = 0;
  let releaseFirstProvider!: () => void;
  const firstProviderHeld = new Promise<void>((resolve) => {
    releaseFirstProvider = resolve;
  });
  let notifyProviderEntered!: () => void;
  const providerEntered = new Promise<void>((resolve) => {
    notifyProviderEntered = resolve;
  });
  const invoke = () => runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "article_hero",
    resourceId: 77,
    resourceVersion: "same-old-url",
    generate: async () => {
      physicalCalls++;
      notifyProviderEntered();
      await firstProviderHeld;
      return "bytes";
    },
    persist: async () => "new-url",
    _deps: deps,
  });

  const first = invoke();
  await providerEntered;
  await assert.rejects(
    invoke,
    (error: any) =>
      ["IMAGE_GENERATION_IN_PROGRESS", "RECONCILIATION_REQUIRED"].includes(error?.code) &&
      error?.statusCode === 409,
  );
  assert.equal(physicalCalls, 1);
  releaseFirstProvider();
  await first;
});

void test("confirmed pre-accept failure clears only its claim and a retry can succeed", async () => {
  const state: FakeState = { flagged: false };
  const deps = fakeDeps(state);
  let physicalCalls = 0;
  const first = () => runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "media_asset",
    resourceId: 88,
    resourceVersion: "unchanged-url",
    generate: async () => {
      physicalCalls++;
      throw new Error("fake confirmed provider rejection");
    },
    persist: async () => "unused",
    _deps: deps,
  });
  await assert.rejects(first, /confirmed provider rejection/);
  assert.equal(state.flagged, false);
  assert.equal(state.released, 1);

  const delivered = await runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "media_asset",
    resourceId: 88,
    resourceVersion: "unchanged-url",
    generate: async () => {
      physicalCalls++;
      return "bytes";
    },
    persist: async () => "new-url",
    _deps: deps,
  });
  assert.equal(delivered, "new-url");
  assert.equal(physicalCalls, 2);
});

void test("provider-entry claim is reconciliation-flagged before provider code executes", async () => {
  const state: FakeState = { flagged: false };
  let observedFlagAtProviderEntry = false;
  await runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "article_hero",
    resourceId: 91,
    resourceVersion: "old-url",
    generate: async () => {
      observedFlagAtProviderEntry = state.flagged;
      return "bytes";
    },
    persist: async () => "new-url",
    _deps: fakeDeps(state),
  });
  assert.equal(observedFlagAtProviderEntry, true);
});

void test("claimed run blocks same resource even when the observed version changes", async () => {
  const state: FakeState = { flagged: false };
  const deps = fakeDeps(state);
  let physicalCalls = 0;
  let releaseProvider!: () => void;
  const providerHeld = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  let notifyEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    notifyEntered = resolve;
  });
  const first = runDirectImageOperation({
    teamId: 7,
    userId: 11,
    resourceType: "article_hero",
    resourceId: 93,
    resourceVersion: "old-url",
    generate: async () => {
      physicalCalls++;
      notifyEntered();
      await providerHeld;
      return "bytes";
    },
    persist: async () => "new-url",
    _deps: deps,
  });
  await entered;
  await assert.rejects(
    () => runDirectImageOperation({
      teamId: 7,
      userId: 11,
      resourceType: "article_hero",
      resourceId: 93,
      resourceVersion: "new-url-observed-after-link",
      generate: async () => {
        physicalCalls++;
        return "duplicate";
      },
      persist: async () => "duplicate-url",
      _deps: deps,
    }),
    (error: any) => error?.statusCode === 409,
  );
  assert.equal(physicalCalls, 1);
  releaseProvider();
  await first;
});

void test("all direct image routes require tenant auth and ownership-filter resources", () => {
  const routes = [
    "app/api/articles/[id]/regenerate-hero/route.ts",
    "app/api/content/[id]/regenerate-hero-image/route.ts",
    "app/api/media/[id]/regenerate/route.ts",
  ];
  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /withAuthenticatedTeamContext/);
    assert.match(source, /eq\((articles|articleAssets)\.teamId, teamId\)/);
    assert.match(source, /runDirectImageOperation/);
  }
});