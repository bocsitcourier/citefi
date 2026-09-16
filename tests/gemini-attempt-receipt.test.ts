import assert from "node:assert/strict";
import test from "node:test";
import {
  extractGeminiRequestLimits,
  extractRawGeminiUsage,
  submitGeminiWithReceipt,
} from "../lib/gemini-attempt-receipt";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} from "../lib/provider-attempt-receipts";
import {
  providerInvocationIdentityForJob,
  runWithProviderInvocationIdentity,
} from "../lib/provider-invocation-identity";
import { extractGeminiUsage } from "../lib/cost-telemetry";

function deps() {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const ledger: unknown[] = [];
  return {
    store,
    spool,
    ledger,
    _deps: {
      store,
      spool,
      validateOwnership: async () => undefined,
      recordUsage: async (input: unknown) => {
        ledger.push(input);
        return { inserted: true };
      },
    },
  };
}

test("Gemini queue redelivery reuses one physical call without an explicit stage key", async () => {
  const fixture = deps();
  let calls = 0;
  const request = { model: "gemini-2.5-flash", contents: "same request" };
  const identity = providerInvocationIdentityForJob("gemini-generation", {
    id: "queue-job-42",
    data: {},
  });
  const submit = () =>
    submitGeminiWithReceipt(
      request,
      { teamId: 42, operationType: "article_generation" },
      async () => {
        calls++;
        return {
          responseId: "gemini-redelivery-123",
          usageMetadata: { totalTokenCount: 1 },
        } as never;
      },
      fixture._deps,
    );

  await runWithProviderInvocationIdentity(identity, submit);
  await assert.rejects(
    () => runWithProviderInvocationIdentity(identity, submit),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(calls, 1);
});

test("Gemini intentional invocation keys permit the same request twice", async () => {
  const fixture = deps();
  let calls = 0;
  const request = { model: "gemini-2.5-flash", contents: "same request" };

  for (const invocationKey of ["gemini-invocation-a", "gemini-invocation-b"]) {
    await runWithProviderInvocationIdentity(invocationKey, () =>
      submitGeminiWithReceipt(
        request,
        { teamId: 42, operationType: "article_generation" },
        async () => {
          calls++;
          return {
            responseId: `gemini-intentional-${calls}`,
            usageMetadata: { totalTokenCount: 1 },
          } as never;
        },
        fixture._deps,
      ),
    );
  }
  assert.equal(calls, 2);
  assert.equal(fixture.store.rows.size, 2);
});

test("request envelope is safe and excludes prompt/customer content", () => {
  const limits = extractGeminiRequestLimits({
    maxOutputTokens: 512,
    temperature: 0.2,
    responseMimeType: "application/json",
    responseModalities: ["TEXT"],
    imageConfig: { aspectRatio: "16:9" },
    thinkingConfig: { thinkingBudget: 256 },
    responseSchema: {
      type: "object",
      description: "do not persist this schema",
      properties: { answer: { type: "string" } },
    },
  });

  assert.deepEqual(limits, {
    maxOutputTokens: 512,
    temperature: 0.2,
    responseMimeType: "application/json",
    responseModalities: ["TEXT"],
    imageAspectRatio: "16:9",
    thinkingBudget: 256,
  });
  assert.equal(JSON.stringify(limits).includes("do not persist"), false);
});

test("physical call is gated and raw provider usage is captured before return", async () => {
  const events: string[] = [];
  let submitted = 0;
  const fixture = deps();
  const result = await submitGeminiWithReceipt<any>(
    {
      model: "gemini-3.5-flash",
      contents: [{ role: "user", parts: [{ text: "customer prompt" }] }],
      config: { maxOutputTokens: 128 },
    },
    { teamId: 42, operationType: "article_generation", attempt: 1 },
    async () => {
      events.push("provider");
      submitted += 1;
      return {
        modelVersion: "gemini-3.5-flash-001",
        responseId: "response-123",
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 9,
          totalTokenCount: 21,
          thoughtsTokenCount: 3,
        },
      } as never;
    },
    {
      ...fixture._deps,
      store: new (class extends MemoryProviderAttemptReceiptStore {
        async prepare(receipt: any) {
          events.push("begin");
          return super.prepare(receipt);
        }
        async captureResponse(sourceEventId: string, capture: any, capturedAt: Date) {
          events.push("capture");
          return super.captureResponse(sourceEventId, capture, capturedAt);
        }
      })(),
    },
  );

  assert.equal(submitted, 1);
  assert.deepEqual(events, ["begin", "provider", "capture"]);
  assert.equal(result.responseId, "response-123");
  assert.equal(fixture.ledger.length, 1);
  const ledgerInput = fixture.ledger[0] as Record<string, unknown>;
  assert.equal(ledgerInput.inputUnits, 12);
  assert.equal(ledgerInput.outputUnits, 9);
});

test("separate helper invocations with identical config are distinct attempts", async () => {
  const fixture = deps();
  const request = {
    model: "gemini-2.5-flash",
    contents: "same safe config",
    config: { maxOutputTokens: 64 },
  };
  const context = { teamId: 42, operationType: "article_generation" };
  await submitGeminiWithReceipt(
    request,
    context,
    async () => ({ responseId: "first", usageMetadata: { totalTokenCount: 1 } } as never),
    fixture._deps,
  );
  await submitGeminiWithReceipt(
    request,
    context,
    async () => ({ responseId: "second", usageMetadata: { totalTokenCount: 1 } } as never),
    fixture._deps,
  );
  assert.equal(fixture.ledger.length, 2);
});

test("raw Gemini fields and response identity survive the accounting boundary", async () => {
  const fixture = deps();
  const response = {
    responseId: "raw-response",
    modelVersion: "gemini-2.5-flash-001",
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 4,
      totalTokenCount: 14,
      thoughtsTokenCount: 7,
      cachedContentTokenCount: 2,
      toolUsePromptTokenCount: 3,
    },
  } as never;
  await submitGeminiWithReceipt(
    { model: "gemini-2.5-flash", contents: "safe test input" },
    { teamId: 7, operationType: "article_generation" },
    async () => response,
    fixture._deps,
  );
  const receipt = [...fixture.store.rows.values()][0]!;
  assert.deepEqual(receipt.responseUsage?.raw, {
    promptTokenCount: 10,
    candidatesTokenCount: 4,
    totalTokenCount: 14,
    thoughtsTokenCount: 7,
    cachedContentTokenCount: 2,
    toolUsePromptTokenCount: 3,
  });
  assert.equal(receipt.responseMetadata?.actualModel, "gemini-2.5-flash-001");
  assert.equal(
    extractGeminiUsage(response).providerAttemptSourceEventId,
    receipt.sourceEventId,
  );
});

test("missing response usage remains unknown rather than becoming zero", () => {
  assert.deepEqual(extractRawGeminiUsage({}), { usage: {}, usageKnown: false });
  assert.deepEqual(
    extractRawGeminiUsage({ usageMetadata: { promptTokenCount: 0 } }),
    { usage: { promptTokenCount: 0 }, usageKnown: false },
  );
});

test("response capture failure does not replay the provider call", async () => {
  let submitted = 0;
  const fixture = deps();
  fixture._deps.recordUsage = async () => {
    throw new Error("ledger outage");
  };

  await assert.rejects(
    submitGeminiWithReceipt(
      { model: "gemini-2.5-flash", contents: "safe test input" },
      { teamId: 7, operationType: "other", attempt: 1 },
      async () => {
        submitted += 1;
        return {
          responseId: "paid-response",
          usageMetadata: { totalTokenCount: 1 },
        } as never;
      },
      fixture._deps,
    ),
    /immutable accounting failed|ledger outage/,
  );
  assert.equal(submitted, 1);
  assert.equal(fixture.ledger.length, 0);
});

test("invalid ownership context is rejected before the provider call", async () => {
  let submitted = false;
  const fixture = deps();
  await assert.rejects(
    submitGeminiWithReceipt(
      { model: "gemini-2.5-flash", contents: "safe test input" },
      { teamId: 0, operationType: "other" },
      async () => {
        submitted = true;
        return {} as never;
      },
      fixture._deps,
    ),
    /positive teamId/,
  );
  assert.equal(submitted, false);
});
