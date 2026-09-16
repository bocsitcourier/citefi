import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";

const receipts = await import("../lib/provider-attempt-receipts");
type ReceiptDeps = import("../lib/provider-attempt-receipts").ProviderAttemptReceiptDependencies;
type ReceiptHandle = import("../lib/provider-attempt-receipts").ProviderAttemptHandle;

function options(
  deps: ReceiptDeps,
  submit: (attempt: ReceiptHandle) => Promise<string>,
) {
  return {
    context: {
      teamId: 7,
      campaignId: 11,
      resourceType: "article",
      resourceId: 42,
      operationType: "article_generation",
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      attemptKey: "run-7-attempt-1",
    },
    request: {
      model: "gemini-2.5-flash",
      maxOutputTokens: 512,
      timeoutMs: 20_000,
    },
    submit,
    _deps: deps,
  };
}

test("ownership is checked before receipt persistence or physical submission", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  let calls = 0;
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        {
          store,
          validateOwnership: async () => {
            throw new Error("article 42 does not belong to team 7");
          },
        },
        async () => {
          calls++;
          return "must-not-run";
        },
      ),
    ),
    /does not belong/,
  );
  assert.equal(calls, 0);
  assert.equal(store.rows.size, 0);
});

test("concurrent callers admit one physical provider submission", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  let calls = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input) => ({ sourceEventId: input.sourceEventId }),
  };
  const submit = async ({ captureResponse }: ReceiptHandle) => {
    calls++;
    await captureResponse({
      usage: { unitType: "tokens", unitCount: 3, inputUnits: 2, outputUnits: 1, known: true },
    });
    return "one-result";
  };
  const results = await Promise.allSettled([
    receipts.runWithProviderAttempt(options(deps, submit)),
    receipts.runWithProviderAttempt(options(deps, submit)),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason?.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
    ).length,
    1,
  );
});

test("pre-call database outage and submission CAS failure fail closed without spool admission", async () => {
  const prepareOutage = new receipts.MemoryProviderAttemptReceiptStore();
  prepareOutage.failPrepare = true;
  const prepareSpool = new receipts.MemoryProviderAttemptReceiptSpool();
  let calls = 0;
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        {
          store: prepareOutage,
          spool: prepareSpool,
          validateOwnership: async () => undefined,
        },
        async () => {
          calls++;
          return "must-not-run";
        },
      ),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_NOT_DURABLE",
  );
  assert.equal(calls, 0);
  assert.equal(prepareSpool.rows.size, 0);

  const casStore = new receipts.MemoryProviderAttemptReceiptStore();
  const casSpool = new receipts.MemoryProviderAttemptReceiptSpool();
  casStore.failStatus = true;
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        {
          store: casStore,
          spool: casSpool,
          validateOwnership: async () => undefined,
        },
        async () => {
          calls++;
          return "must-not-run";
        },
      ),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_NOT_DURABLE",
  );
  assert.equal(calls, 0);
  assert.equal(casSpool.rows.size, 0);

  const spoolOutageStore = new receipts.MemoryProviderAttemptReceiptStore();
  const spoolOutage = new receipts.MemoryProviderAttemptReceiptSpool();
  spoolOutage.failWrite = true;
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        {
          store: spoolOutageStore,
          spool: spoolOutage,
          validateOwnership: async () => undefined,
        },
        async () => {
          calls++;
          return "must-not-run";
        },
      ),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_NOT_DURABLE",
  );
  assert.equal(calls, 0);
  assert.equal(spoolOutage.rows.size, 0);
});

test("response-save outage falls back durably and retry cannot submit twice", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  store.failCapture = true;
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  let calls = 0;
  let ledgerWrites = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async (event) => {
      ledgerWrites++;
      assert.equal(event.unitCount, 21);
      assert.equal(event.sourceEventId?.startsWith("provider-attempt:"), true);
      return { id: 1 };
    },
  };
  const first = await receipts.runWithProviderAttempt(
    options(deps, async ({ captureResponse }) => {
      calls++;
      await captureResponse({
        providerRequestId: "response-123",
        usage: {
          unitType: "tokens",
          inputUnits: 12,
          outputUnits: 9,
          unitCount: 21,
          known: true,
        },
      });
      return "result";
    }),
  );
  assert.equal(first, "result");
  assert.equal(calls, 1);
  assert.equal(ledgerWrites, 1);
  const sourceEventId = [...spool.rows.keys()][0];
  if (!sourceEventId) throw new Error("receipt source event was not spooled");
  const spooled = spool.rows.get(sourceEventId);
  assert.equal(spooled?.providerRequestId, "response-123");
  assert.equal(spooled?.responseUsage?.unitCount, 21);
  assert.equal(JSON.stringify(spooled).includes("customer"), false);

  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(deps, async () => {
        calls++;
        return "duplicate";
      }),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(calls, 1);
  assert.equal(ledgerWrites, 1);
});

test("partial response usage is retained as evidence but never becomes zero ledger usage", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  let calls = 0;
  let ledgerWrites = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async () => {
      ledgerWrites++;
      return { id: 1 };
    },
  };
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(deps, async ({ captureResponse }) => {
        calls++;
        await captureResponse({
          usage: {
            unitType: "tokens",
            inputUnits: 12,
            known: false,
            raw: {
              promptTokenCount: 12,
              thoughtsTokenCount: 3,
              cachedContentTokenCount: 4,
              customerPrompt: 999,
            },
          },
        });
        return "not-durable";
      }),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_USAGE_UNAVAILABLE",
  );
  assert.equal(calls, 1);
  assert.equal(ledgerWrites, 0);
  const responseUsage = [...store.rows.values()][0]?.responseUsage;
  assert.equal(responseUsage?.known, false);
  assert.equal(responseUsage?.unitCount, null);
  assert.equal(responseUsage?.inputUnits, 12);
  assert.deepEqual(responseUsage?.raw, {
    promptTokenCount: 12,
    thoughtsTokenCount: 3,
    cachedContentTokenCount: 4,
  });
});

test("provider rejection receipt stores only fixed safe classification", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        {
          store,
          spool,
          validateOwnership: async () => undefined,
        },
        async () => {
          throw Object.assign(
            new Error("secret customer prompt and provider response"),
            { code: "E_PROVIDER_PRIVATE_DETAIL" },
          );
        },
      ),
    ),
  );
  const receipt = [...store.rows.values()][0];
  assert.equal(receipt?.status, "provider_rejected");
  assert.equal(receipt?.failureCode, "PROVIDER_REJECTED");
  assert.equal(receipt?.failureMessage, "PROVIDER_REJECTED");
  assert.equal(JSON.stringify(receipt).includes("secret customer prompt"), false);
});

test("failed provider telemetry is operational-only without captured exact usage", async () => {
  const telemetry = await import("../lib/cost-telemetry");
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  let ledgerWrites = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async () => {
      ledgerWrites++;
      return { id: 99 };
    },
  };
  const secret = "customer prompt must never become receipt failure text";
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(
        deps,
        async () => {
          await telemetry.logFailedProviderAttempt(
            {
              teamId: 7,
              operationType: "article_generation",
              provider: "gemini",
              model: "gemini-2.5-flash",
            },
            { inputTokens: 0, outputTokens: 0, totalTokens: 0, known: false },
            1,
            Object.assign(new Error(secret), { code: "E_PROVIDER_PRIVATE_DETAIL" }),
          );
          throw new Error(secret);
        },
      ),
    ),
    (error: any) => error?.message === secret,
  );
  assert.equal(ledgerWrites, 0);
  const receipt = [...store.rows.values()][0];
  assert.equal(receipt?.status, "provider_rejected");
  assert.equal(receipt?.failureCode, "PROVIDER_REJECTED");
  assert.equal(receipt?.failureMessage, "PROVIDER_REJECTED");
  assert.equal(JSON.stringify(receipt).includes(secret), false);
});

test("ledger outage is terminal while receipt remains reconcilable without provider call", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  let calls = 0;
  let ledgerWrites = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async () => {
      ledgerWrites++;
      if (ledgerWrites === 1) throw new Error("ledger unavailable");
      return { id: 9 };
    },
  };
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(deps, async ({ captureResponse }) => {
        calls++;
        await captureResponse({
          usage: { unitType: "tokens", unitCount: 4, inputUnits: 2, outputUnits: 2, known: true },
        });
        return "paid-response";
      }),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );
  assert.equal(calls, 1);
  assert.equal(ledgerWrites, 1);
  const sourceEventId = [...store.rows.keys()][0];
  if (!sourceEventId) throw new Error("receipt source event was not persisted");
  const reconciled = await receipts.reconcileProviderAttempt(
    { sourceEventId },
    {
      store,
      spool,
      recordUsage: deps.recordUsage,
      validateOwnership: async () => undefined,
    },
  );
  assert.equal((reconciled.ledger as any).id, 9);
  assert.equal(ledgerWrites, 2);
});

test("committed-then-throw ledger write reconciles by sourceEventId without duplicate event", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  const committed = new Map<string, { id: number; sourceEventId: string }>();
  let ledgerAttempts = 0;
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input) => {
      ledgerAttempts++;
      const sourceEventId = input.sourceEventId as string;
      const existing = committed.get(sourceEventId);
      if (existing) return { event: existing, inserted: false };
      const event = { id: 77, sourceEventId };
      committed.set(sourceEventId, event);
      if (ledgerAttempts === 1) throw new Error("connection dropped after commit");
      return { event, inserted: true };
    },
  };
  await assert.rejects(
    receipts.runWithProviderAttempt(
      options(deps, async ({ captureResponse }) => {
        await captureResponse({
          usage: { unitType: "tokens", unitCount: 5, inputUnits: 3, outputUnits: 2, known: true },
        });
        return "paid-response";
      }),
    ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );
  assert.equal(committed.size, 1);
  const sourceEventId = [...committed.keys()][0];
  if (!sourceEventId) throw new Error("ledger source event was not committed");
  const reconciled = await receipts.reconcileProviderAttempt(
    { sourceEventId },
    {
      store,
      spool,
      recordUsage: deps.recordUsage,
      validateOwnership: async () => undefined,
    },
  );
  assert.equal((reconciled.ledger as any).event.id, 77);
  assert.equal(committed.size, 1);
  assert.equal(ledgerAttempts, 2);
});

test("post-call telemetry uses canonical receipt attribution rather than rebuilt context", async () => {
  const telemetry = await import("../lib/cost-telemetry");
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  const ledgerInputs: any[] = [];
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input) => {
      ledgerInputs.push(input);
      return { id: 88 };
    },
  };
  await receipts.runWithProviderAttempt({
    ...options(deps, async () => {
      await telemetry.logCostTelemetry(
        {
          teamId: 7,
          operationType: "article_generation",
          provider: "gemini",
          model: "gemini-2.5-flash",
          runId: "post-call-context",
          providerRequestId: "post-call-provider-id",
        },
        { inputTokens: 3, outputTokens: 2, totalTokens: 5, known: true },
        1,
      );
      return "result";
    }),
  });
  assert.equal(ledgerInputs.length, 1);
  assert.equal(ledgerInputs[0].runId, null);
  assert.equal(ledgerInputs[0].campaignId, 11);
  assert.match(ledgerInputs[0].sourceEventId, /^provider-attempt:/);
});

test("already-accounted reconciliation still checks tenant ownership", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  const deps: ReceiptDeps = {
    store,
    spool,
    validateOwnership: async () => undefined,
    recordUsage: async () => ({ id: 1 }),
  };
  await receipts.runWithProviderAttempt(
    options(deps, async ({ captureResponse }) => {
      await captureResponse({
        usage: { unitType: "tokens", unitCount: 1, inputUnits: 1, outputUnits: 0, known: true },
      });
      return "result";
    }),
  );
  const sourceEventId = [...store.rows.keys()][0];
  if (!sourceEventId) throw new Error("receipt source event was not persisted");
  await assert.rejects(
    receipts.reconcileProviderAttempt(
      { sourceEventId },
      {
        store,
        spool,
        validateOwnership: async () => {
          throw new Error("cross-tenant receipt");
        },
      },
    ),
    /cross-tenant receipt/,
  );
});

test("source event identity is deterministic for one receipt request", () => {
  const context = {
    teamId: 7,
    operationType: "other",
    provider: "openai" as const,
    model: "gpt-4.1-mini",
    attemptKey: "same-attempt",
  };
  const request = { model: "gpt-4.1-mini", maxOutputTokens: 20 };
  assert.equal(
    receipts.deterministicProviderAttemptSourceEventId(context, request),
    receipts.deterministicProviderAttemptSourceEventId({ ...context }, { ...request }),
  );
});

test("async operation identity survives polling and upgrades only to returned usage", async () => {
  const store = new receipts.MemoryProviderAttemptReceiptStore();
  const spool = new receipts.MemoryProviderAttemptReceiptSpool();
  const entries: Array<{ occurredAt?: Date; unitCount: number }> = [];
  const deps: ReceiptDeps = {
    store, spool,
    validateOwnership: async () => undefined,
    recordUsage: async (input) => { entries.push(input); },
  };
  let submitted = 0;
  await receipts.runWithProviderAttempt(options(deps, async ({ captureResponse, receipt }) => {
    submitted++;
    await captureResponse({
      providerRequestId: "operation-async",
      usage: { unitType: "seconds", unitCount: null, known: false },
      metadata: { operationId: "operation-async" },
    });
    assert.equal(store.rows.get(receipt.sourceEventId)?.providerRequestId, "operation-async");
    assert.equal(entries.length, 0, "submission acknowledgement is not billable usage");
    await captureResponse({
      providerRequestId: "operation-async",
      usage: { unitType: "seconds", unitCount: 6, known: true },
      metadata: { operationId: "operation-async" },
    });
    await assert.rejects(captureResponse({
      providerRequestId: "operation-async",
      usage: { unitType: "seconds", unitCount: 12, known: true },
    }), /usage changed/);
    return "completed";
  }));
  assert.equal(submitted, 1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.unitCount, 6);
  const receipt = [...store.rows.values()][0]!;
  assert.equal(entries[0]?.occurredAt?.getTime(), receipt.usageCapturedAt?.getTime());
});

test("spool JSON parser rejects unbounded or malformed receipt fields", () => {
  assert.throws(
    () =>
      receipts.parseProviderAttemptReceiptSpoolRecord(
        JSON.stringify({
          spoolVersion: 1,
          sourceEventId: "provider-attempt:strict",
          teamId: 7,
          status: "submitted",
          preparedAt: new Date().toISOString(),
          unknownSecretField: "not allowed",
        }),
      ),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_NOT_DURABLE",
  );
});
