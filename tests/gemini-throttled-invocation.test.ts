import assert from "node:assert/strict";
import test from "node:test";

// Keep this offline test from waiting for the production one-request-per-second
// default.  No SDK request is made; the callback only observes ALS.
process.env.GEMINI_API_KEY ??= "offline-test-key";
process.env.GEMINI_RATE_LIMIT ??= "60000";

const {
  closeGeminiRateLimiter,
  throttledGeminiRequest,
} = await import("../lib/gemini");
const { submitGeminiWithReceipt } = await import("../lib/gemini-attempt-receipt");
const {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} = await import("../lib/provider-attempt-receipts");
const {
  currentProviderInvocationIdentity,
  runWithProviderInvocationIdentity,
} = await import("../lib/provider-invocation-identity");

test("Gemini limiter callback preserves the submitting invocation ALS", async () => {
  const observed = await runWithProviderInvocationIdentity(
    "gemini-limiter-job",
    () =>
      throttledGeminiRequest(async () =>
        currentProviderInvocationIdentity()?.invocationKey,
      ),
  );
  assert.equal(observed, "gemini-limiter-job:call:0");
});

test("anonymous throttled calls get distinct child slots and redelivery reuses them", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const ledger: unknown[] = [];
  const deps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input: unknown) => {
      ledger.push(input);
      return { inserted: true };
    },
  };
  let physicalCalls = 0;
  const invoke = () =>
    throttledGeminiRequest(() =>
      submitGeminiWithReceipt(
        { model: "gemini-2.5-flash", contents: "same request" },
        { teamId: 7, operationType: "article_generation" },
        async () => {
          physicalCalls++;
          return {
            responseId: `gemini-throttled-${physicalCalls}`,
            usageMetadata: { totalTokenCount: 1 },
          } as never;
        },
        deps,
      ),
    );
  const identity = {
    invocationKey: "gemini-throttled-job",
    callSequence: 0,
    replayable: true,
  };

  await runWithProviderInvocationIdentity(identity, async () => {
    await invoke();
    await invoke();
  });
  assert.equal(physicalCalls, 2);
  assert.equal(store.rows.size, 2);

  await assert.rejects(
    () => runWithProviderInvocationIdentity(identity, invoke),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(physicalCalls, 2);
  assert.equal(ledger.length, 2);
});

test.after(async () => {
  await closeGeminiRateLimiter();
});