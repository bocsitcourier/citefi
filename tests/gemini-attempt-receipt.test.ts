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
  reconcileProviderAttempt,
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
          usageMetadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 1,
            thoughtsTokenCount: 0,
            totalTokenCount: 1,
          },
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
            usageMetadata: {
              promptTokenCount: 0,
              candidatesTokenCount: 1,
              thoughtsTokenCount: 0,
              totalTokenCount: 1,
            },
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
  // Gemini's aggregate total includes thoughts, so candidate tokens are not
  // charged a second time when the aggregate already accounts for them.
  assert.equal(ledgerInput.outputUnits, 9);
});

test("Gemini receipt bills thinking once while retaining native aggregate usage", async () => {
  const fixture = deps();
  const response = {
    responseId: "thinking-response",
    usageMetadata: {
      promptTokenCount: 6_674,
      candidatesTokenCount: 1_364,
      thoughtsTokenCount: 15_004,
      totalTokenCount: 23_042,
    },
  } as never;
  await submitGeminiWithReceipt(
    { model: "gemini-3.5-flash", contents: "safe test input" },
    { teamId: 7, operationType: "article_generation" },
    async () => response,
    fixture._deps,
  );
  const receipt = [...fixture.store.rows.values()][0]!;
  const ledgerInput = fixture.ledger[0] as Record<string, unknown>;
  assert.equal(receipt.responseUsage?.unitCount, 23_042);
  assert.deepEqual(receipt.responseUsage?.raw, {
    promptTokenCount: 6_674,
    candidatesTokenCount: 1_364,
    thoughtsTokenCount: 15_004,
    totalTokenCount: 23_042,
  });
  assert.equal(ledgerInput.inputUnits, 6_674);
  assert.equal(ledgerInput.outputUnits, 16_368);
  assert.equal(extractGeminiUsage(response).outputTokens, 16_368);
});

test("Gemini thinking normalization handles missing and invalid counts safely", async () => {
  assert.equal(
    extractGeminiUsage({
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 5,
        totalTokenCount: 8,
      },
    }).outputTokens,
    5,
  );
  assert.equal(
    extractGeminiUsage({
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 5,
        thoughtsTokenCount: -3,
        totalTokenCount: 8,
      },
    }).outputTokens,
    5,
  );
  assert.equal(
    extractGeminiUsage({
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        thoughtsTokenCount: Number.MAX_SAFE_INTEGER + 1,
        totalTokenCount: 4,
      },
    }).outputTokens,
    3,
  );
  assert.equal(
    extractGeminiUsage({
      usageMetadata: {
        candidatesTokenCount: 5,
        thoughtsTokenCount: 1,
      },
    }).known,
    false,
  );
  const completeSplit = extractGeminiUsage({
    usageMetadata: {
      promptTokenCount: 3,
      candidatesTokenCount: 5,
      thoughtsTokenCount: 2,
    },
  });
  assert.equal(completeSplit.known, true);
  assert.equal(completeSplit.outputTokens, 7);
  assert.equal(completeSplit.totalTokens, 10);
});

test("Gemini receipt boundary fails closed on missing or inconsistent aggregate splits", async () => {
  for (const [name, usageMetadata] of [
    ["missing prompt with total", { totalTokenCount: 12, candidatesTokenCount: 2, thoughtsTokenCount: 3 }],
    ["candidate exceeds aggregate output", {
      promptTokenCount: 10,
      totalTokenCount: 12,
      candidatesTokenCount: 3,
      thoughtsTokenCount: 1,
    }],
    ["missing thinking without aggregate", {
      promptTokenCount: 10,
      candidatesTokenCount: 2,
    }],
    ["invalid thinking without aggregate", {
      promptTokenCount: 10,
      candidatesTokenCount: 2,
      thoughtsTokenCount: -1,
    }],
  ] as const) {
    const fixture = deps();
    await assert.rejects(
      submitGeminiWithReceipt(
        { model: "gemini-3.5-flash", contents: `safe ${name}` },
        { teamId: 7, operationType: "article_generation" },
        async () => ({ usageMetadata } as never),
        fixture._deps,
      ),
      (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
    );
    assert.equal(fixture.ledger.length, 0, name);
    const receipt = [...fixture.store.rows.values()][0]!;
    assert.equal(receipt.responseUsage?.known, false, name);
  }
});

test("Gemini aggregate remains authoritative with missing or invalid thinking", async () => {
  for (const usageMetadata of [
    { promptTokenCount: 10, totalTokenCount: 15, candidatesTokenCount: 5 },
    {
      promptTokenCount: 10,
      totalTokenCount: 15,
      candidatesTokenCount: 5,
      thoughtsTokenCount: -1,
    },
  ]) {
    const fixture = deps();
    await submitGeminiWithReceipt(
      { model: "gemini-3.5-flash", contents: "safe aggregate request" },
      { teamId: 7, operationType: "article_generation" },
      async () => ({ usageMetadata } as never),
      fixture._deps,
    );
    const ledgerInput = fixture.ledger[0] as Record<string, unknown>;
    assert.equal(ledgerInput.outputUnits, 5);
    const receipt = [...fixture.store.rows.values()][0]!;
    assert.equal(receipt.responseUsage?.unitCount, 15);
    assert.equal(receipt.responseUsage?.known, true);
  }
});

test("native image-only response with thoughtSignature preserves IMAGE modality usage", async () => {
  const { readFileSync } = await import("node:fs");
  const response = JSON.parse(readFileSync(
    new URL("../QA/evidence/live-current/live-media-image-20261008/image-native-response.json", import.meta.url),
    "utf8",
  ));
  const fixture = deps();
  await submitGeminiWithReceipt(
    { model: "gemini-3.1-flash-image", contents: "offline replay", config: { responseModalities: ["IMAGE"] } },
    { teamId: 7, operationType: "image_generation" },
    async () => response,
    fixture._deps,
  );
  const receipt = [...fixture.store.rows.values()][0]!;
  assert.equal(receipt.status, "accounted");
  assert.equal(receipt.providerRequestId, response.responseId);
  assert.equal(receipt.responseUsage?.outputUnits, 1120);
  assert.equal(receipt.responseUsage?.raw?.imageOutputTokens, 1120);
  assert.equal(receipt.responseUsage?.raw?.otherOutputTokens, 492);
  assert.equal(receipt.responseUsage?.raw?.candidatesTokenCount, 1612);
  assert.equal((fixture.ledger[0] as Record<string, unknown>).outputUnits, 1120);
  const primary = fixture.ledger[0] as Record<string, unknown>;
  const secondary = fixture.ledger[1] as Record<string, unknown>;
  assert.equal(secondary.sourceEventId, `${primary.sourceEventId}:text-output`);
  assert.equal(secondary.providerRequestId, primary.providerRequestId);
  assert.equal(secondary.unitType, "tokens");
  assert.equal(secondary.inputUnits, 0);
  assert.equal(secondary.outputUnits, 492);
  assert.equal(secondary.unitCount, 492);
});

test("image text/thinking reconciliation retries deterministic events after a partial write", async () => {
  const fixture = deps();
  const events = new Map<string, any>();
  let fail = true;
  fixture._deps.recordUsage = async (value: unknown) => {
    const input = value as any;
    const existing = events.get(input.sourceEventId);
    if (existing) assert.deepEqual(existing, input);
    events.set(input.sourceEventId, input);
    if (input.sourceEventId.endsWith(":text-output") && fail) {
      fail = false;
      throw new Error("committed then acknowledgement lost");
    }
    return { inserted: !existing };
  };
  await assert.rejects(submitGeminiWithReceipt(
    { model: "gemini-3.1-flash-image", contents: "fixture", config: { responseModalities: ["IMAGE"] } },
    { teamId: 7, operationType: "image_generation" },
    async () => ({
      responseId: "fixture-image-split",
      usageMetadata: {
        promptTokenCount: 172, candidatesTokenCount: 1600, thoughtsTokenCount: 20, totalTokenCount: 1792,
        candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }],
      },
      candidates: [{ content: { parts: [{ inlineData: { data: "fixture" } }] } }],
    } as never),
    fixture._deps,
  ), { code: "PROVIDER_ATTEMPT_ACCOUNTING_FAILED" });
  const receipt = [...fixture.store.rows.values()][0]!;
  await reconcileProviderAttempt({ sourceEventId: receipt.sourceEventId }, fixture._deps);
  await reconcileProviderAttempt({ sourceEventId: receipt.sourceEventId }, fixture._deps);
  assert.equal(events.size, 2);
  assert.equal(events.get(`${receipt.sourceEventId}:text-output`).outputUnits, 500);
  assert.equal(events.get(`${receipt.sourceEventId}:text-output`).unitCount, 500);
});

test("Gemini image requests retain image unit semantics with thinking usage", async () => {
  const fixture = deps();
  await submitGeminiWithReceipt(
    {
      model: "gemini-3.5-flash",
      contents: "safe image request",
      config: { responseModalities: ["IMAGE"] },
    },
    { teamId: 7, operationType: "image_generation" },
    async () => ({
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 10,
        thoughtsTokenCount: 5,
        totalTokenCount: 115,
        candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 10 }],
      },
      candidates: [{
        content: { parts: [{ inlineData: { data: "encoded-image" } }] },
      }],
    } as never),
    fixture._deps,
  );
  const ledgerInput = fixture.ledger[0] as Record<string, unknown>;
  assert.equal(ledgerInput.unitType, "images");
  assert.equal(ledgerInput.unitCount, 1);
  assert.equal(ledgerInput.outputUnits, 10);

  const imageOnlyFixture = deps();
  await assert.rejects(submitGeminiWithReceipt(
    {
      model: "gemini-3.5-flash",
      contents: "safe image request with partial token metadata",
      config: { responseModalities: ["IMAGE"] },
    },
    { teamId: 7, operationType: "image_generation" },
    async () => ({
      usageMetadata: { promptTokenCount: -1, totalTokenCount: 100 },
      candidates: [{
        content: { parts: [{ inlineData: { data: "encoded-image" } }] },
      }],
    } as never),
    imageOnlyFixture._deps,
  ));
  const imageReceipt = [...imageOnlyFixture.store.rows.values()][0]!;
  // Image bytes alone never make a token-priced image billable: without a
  // complete native split the paid receipt is retained unknown, not zero-priced.
  assert.equal(imageReceipt.responseUsage?.known, false);
  assert.equal(imageReceipt.responseUsage?.unitCount, 1);
  assert.equal(imageOnlyFixture.ledger.length, 0);
});

test("image responses missing the IMAGE-modality split or with inconsistent totals stay unknown", async () => {
  for (const usageMetadata of [
    undefined,
    { promptTokenCount: 172, candidatesTokenCount: 1600, totalTokenCount: 1772 },
    { promptTokenCount: 172, candidatesTokenCount: 1600, totalTokenCount: 9999,
      candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] },
    { candidatesTokenCount: 1600, totalTokenCount: 1600,
      candidatesTokensDetails: [{ modality: "IMAGE", tokenCount: 1120 }] },
  ]) {
    const fixture = deps();
    await assert.rejects(submitGeminiWithReceipt(
      { model: "gemini-3.1-flash-image", contents: "fixture", config: { responseModalities: ["IMAGE"] } },
      { teamId: 7, operationType: "image_generation" },
      async () => ({ responseId: "fixture", usageMetadata,
        candidates: [{ content: { parts: [{ inlineData: { data: "encoded-image" } }] } }] } as never),
      fixture._deps,
    ));
    assert.equal(fixture.ledger.length, 0);
    const receipt = [...fixture.store.rows.values()][0]!;
    assert.equal(receipt.responseUsage?.known, false);
    assert.notEqual(receipt.status, "accounted");
  }
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
    async () => ({
      responseId: "first",
      usageMetadata: {
        promptTokenCount: 0,
        candidatesTokenCount: 1,
        thoughtsTokenCount: 0,
        totalTokenCount: 1,
      },
    } as never),
    fixture._deps,
  );
  await submitGeminiWithReceipt(
    request,
    context,
    async () => ({
      responseId: "second",
      usageMetadata: {
        promptTokenCount: 0,
        candidatesTokenCount: 1,
        thoughtsTokenCount: 0,
        totalTokenCount: 1,
      },
    } as never),
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
      totalTokenCount: 21,
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
    totalTokenCount: 21,
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
          usageMetadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 1,
            thoughtsTokenCount: 0,
            totalTokenCount: 1,
          },
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
