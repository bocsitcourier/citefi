import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} from "../lib/provider-attempt-receipts";
import {
  providerInvocationIdentityForJob,
  runWithProviderInvocationIdentity,
} from "../lib/provider-invocation-identity";

process.env.GEMINI_API_KEY ??= "offline-fixture";
process.env.WORKER_PROCESS = "true";
const { buildIntentDrivenAnchors } = await import("../lib/intent-hyperlink-engine");
const { closeGeminiRateLimiter } = await import("../lib/gemini");

test("intent hyperlink redelivery submits once and intentional regeneration submits independently", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const events = new Set<string>();
  let calls = 0;
  const receipt = {
    store, spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input: { sourceEventId?: string }) => {
      assert.ok(input.sourceEventId);
      const inserted = !events.has(input.sourceEventId);
      events.add(input.sourceEventId);
      return { inserted };
    },
  };
  const run = (id: string) => runWithProviderInvocationIdentity(
    providerInvocationIdentityForJob("article-generation", { id }),
    () => buildIntentDrivenAnchors(
      "<p>Professional support for local families.</p>",
      [{ title: "Family services", url: "https://example.test/services" }] as never,
      "https://example.test", 7,
      {
        receipt,
        generateContent: async () => {
          calls++;
          return {
            text: "[]",
            responseId: `intent-response-${calls}`,
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 },
          } as never;
        },
        logSuccess: async () => undefined,
      },
    ),
  );
  try {
    await run("generation-one");
    await assert.rejects(run("generation-one"), { code: "PROVIDER_ATTEMPT_ALREADY_SUBMITTED" });
    assert.equal(calls, 1);
    assert.equal(events.size, 1);
    await run("intentional-regeneration-two");
    assert.equal(calls, 2);
    assert.equal(events.size, 2);
  } finally {
    await closeGeminiRateLimiter();
  }
});