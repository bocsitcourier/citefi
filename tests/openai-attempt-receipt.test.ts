import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const { callOpenAI } = await import("../lib/openai-client");
const {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} = await import("../lib/provider-attempt-receipts");
const {
  providerInvocationIdentityForJob,
  runWithProviderInvocationIdentity,
} = await import("../lib/provider-invocation-identity");

function receiptDeps(
  store: InstanceType<typeof MemoryProviderAttemptReceiptStore>,
  ledger: Array<Record<string, unknown>>,
) {
  return {
    store,
    spool: new MemoryProviderAttemptReceiptSpool(),
    validateOwnership: async () => undefined,
    recordUsage: async (input: any) => {
      ledger.push(input);
      return { id: ledger.length };
    },
  };
}

test("OpenAI queue redelivery reuses one physical call without a request key", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];
  let calls = 0;
  const identity = providerInvocationIdentityForJob("openai-generation", {
    id: "queue-job-42",
    data: {},
  });
  const call = () =>
    callOpenAI(
      async () => {
        calls++;
        return {
          id: "openai-redelivery-123",
          model: "gpt-4.1-mini",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
      "same request",
      undefined,
      {
        teamId: 7,
        operationType: "article_review",
        model: "gpt-4.1-mini",
        request: { model: "gpt-4.1-mini" },
      },
      { receipt: receiptDeps(store, ledger), sleep: async () => undefined },
    );

  await runWithProviderInvocationIdentity(identity, call);
  await assert.rejects(
    () => runWithProviderInvocationIdentity(identity, call),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(calls, 1);
  assert.equal(ledger.length, 1);
});

test("OpenAI intentional invocation keys permit the same request twice", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];
  let calls = 0;

  for (const invocationKey of ["openai-invocation-a", "openai-invocation-b"]) {
    await callOpenAI(
      async () => {
        calls++;
        return {
          id: `openai-intentional-${calls}`,
          model: "gpt-4.1-mini",
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
      "same request",
      undefined,
      {
        teamId: 7,
        invocationKey,
        operationType: "article_review",
        model: "gpt-4.1-mini",
        request: { model: "gpt-4.1-mini" },
      },
      { receipt: receiptDeps(store, ledger), sleep: async () => undefined },
    );
  }
  assert.equal(calls, 2);
  assert.equal(ledger.length, 2);
  assert.equal(store.rows.size, 2);
});

test("OpenAI response usage and provider id are captured before immutable accounting", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];
  const result = await callOpenAI(
    async () => ({
      id: "chatcmpl-receipt-1",
      model: "gpt-4.1-mini",
      usage: {
        prompt_tokens: 17,
        completion_tokens: 8,
        total_tokens: 25,
        prompt_tokens_details: { cached_tokens: 4 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
      choices: [{ finish_reason: "stop" }],
    }),
    "receipt test operation",
    undefined,
    {
      teamId: 7,
      operationType: "article_review",
      model: "gpt-4.1-mini",
      request: { model: "gpt-4.1-mini", maxOutputTokens: 32 },
    },
    {
      receipt: receiptDeps(store, ledger),
    },
  );

  assert.equal((result as any).id, "chatcmpl-receipt-1");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.unitType, "tokens");
  assert.equal(ledger[0]?.unitCount, 25);
  assert.equal(ledger[0]?.inputUnits, 17);
  assert.equal(ledger[0]?.outputUnits, 8);
  assert.equal(ledger[0]?.providerRequestId, "chatcmpl-receipt-1");

  const [receipt] = [...store.rows.values()];
  assert.equal(receipt?.status, "accounted");
  assert.equal(receipt?.providerRequestId, "chatcmpl-receipt-1");
  assert.equal(receipt?.requestMetadata.model, "gpt-4.1-mini");
  assert.equal(receipt?.requestMetadata.maxOutputTokens, 32);
  assert.equal(receipt?.requestMetadata.timeoutMs, 60000);
  assert.equal(receipt?.requestMetadata.adapterVersion, "openai-client/receipt-v1");
  assert.equal(receipt?.responseUsage?.raw?.prompt_tokens, 17);
  assert.equal(receipt?.responseUsage?.raw?.prompt_cached_tokens, 4);
  assert.equal(receipt?.responseUsage?.raw?.completion_reasoning_tokens, 2);
});

test("missing OpenAI usage is explicit unknown and is never retried or ledgered", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];
  let physicalCalls = 0;

  await assert.rejects(
    () => callOpenAI(
      async () => {
        physicalCalls++;
        return {
          id: "chatcmpl-without-usage",
          model: "gpt-4.1-mini",
          choices: [{ finish_reason: "stop" }],
        };
      },
      "missing usage test",
      undefined,
      {
        teamId: 7,
        operationType: "article_review",
        model: "gpt-4.1-mini",
        request: { model: "gpt-4.1-mini" },
      },
      {
        receipt: receiptDeps(store, ledger),
      },
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
  );

  assert.equal(physicalCalls, 1);
  assert.equal(ledger.length, 0);
  const [receipt] = [...store.rows.values()];
  assert.equal(receipt?.responseUsage?.known, false);
  assert.equal(receipt?.responseUsage?.unitCount, null);
  assert.equal(receipt?.responseUsage?.inputUnits, null);
  assert.equal(receipt?.responseUsage?.outputUnits, null);
  assert.equal(receipt?.status, "reconciliation_required");
});

test("TTS character usage is retained as an exact request billing unit", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];

  await callOpenAI(
    async () => ({
      id: "tts-response-1",
      headers: new Headers({ "x-request-id": "tts-request-header-1" }),
      model: "gpt-4o-mini-tts",
    }),
    "tts receipt test",
    undefined,
    {
      teamId: 7,
      operationType: "podcast_tts",
      model: "gpt-4o-mini-tts",
      usage: { characters: 1234 },
      request: { model: "gpt-4o-mini-tts" },
    },
    {
      receipt: receiptDeps(store, ledger),
    },
  );

  assert.equal(ledger[0]?.unitType, "characters");
  assert.equal(ledger[0]?.unitCount, 1234);
  const [receipt] = [...store.rows.values()];
  assert.equal(receipt?.requestMetadata.maxCharacters, 1234);
  assert.equal(receipt?.providerRequestId, "tts-request-header-1");
});

test("receipt-ledger failure is terminal and never resubmits a paid OpenAI call", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  const ledger: Array<Record<string, unknown>> = [];
  let physicalCalls = 0;
  await assert.rejects(
    () => callOpenAI(
      async () => {
        physicalCalls++;
        return {
          id: "chatcmpl-paid-before-ledger-outage",
          model: "gpt-4.1-mini",
          usage: {
            prompt_tokens: 5,
            completion_tokens: 3,
            total_tokens: 8,
          },
        };
      },
      "ledger failure test",
      undefined,
      {
        teamId: 7,
        operationType: "article_review",
        model: "gpt-4.1-mini",
        request: { model: "gpt-4.1-mini" },
      },
      {
        receipt: {
          ...receiptDeps(store, ledger),
          recordUsage: async () => {
            throw new Error("ledger outage");
          },
        },
      },
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );

  assert.equal(physicalCalls, 1);
  const [receipt] = [...store.rows.values()];
  assert.equal(receipt?.status, "accounting_failed");
});

test("SDK payload model and output limit are checked before physical fetch", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  let physicalFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    physicalFetches++;
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => callOpenAI(
        (client) => client.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content: "receipt test" }],
          max_tokens: 8,
        }),
        "payload metadata mismatch",
        undefined,
        {
          teamId: 7,
          operationType: "article_review",
          model: "gpt-4.1-mini",
          request: { model: "gpt-4.1-mini", maxOutputTokens: 9 },
        },
        {
          receipt: {
            store,
            spool: new MemoryProviderAttemptReceiptSpool(),
            validateOwnership: async () => undefined,
            recordUsage: async () => undefined,
          },
        },
      ),
      (error: any) =>
        error?.cause?.message ===
        "OpenAI SDK output limit did not match prepared receipt metadata",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(physicalFetches, 0);
});

test("TTS SDK input length is checked against exact character bound", async () => {
  const store = new MemoryProviderAttemptReceiptStore();
  let physicalFetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    physicalFetches++;
    return new Response(new ArrayBuffer(0), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => callOpenAI(
        (client) => client.audio.speech.create({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: "four",
        }),
        "tts bound mismatch",
        undefined,
        {
          teamId: 7,
          operationType: "podcast_tts",
          model: "gpt-4o-mini-tts",
          usage: { characters: 5 },
          request: { model: "gpt-4o-mini-tts" },
        },
        {
          receipt: {
            store,
            spool: new MemoryProviderAttemptReceiptSpool(),
            validateOwnership: async () => undefined,
            recordUsage: async () => undefined,
          },
        },
      ),
      (error: any) =>
        error?.cause?.message ===
        "OpenAI SDK TTS input length did not match prepared receipt metadata",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(physicalFetches, 0);
});