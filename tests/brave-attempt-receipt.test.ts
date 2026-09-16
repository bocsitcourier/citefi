import assert from "node:assert/strict";
import test from "node:test";
import {
  submitBraveSearchWithReceipt,
} from "../lib/brave-attempt-receipt";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} from "../lib/provider-attempt-receipts";
import {
  providerInvocationIdentityForJob,
  runWithProviderInvocationIdentity,
} from "../lib/provider-invocation-identity";

function fixture() {
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

function options(
  fixtureValue: ReturnType<typeof fixture>,
  fetchImpl: Parameters<typeof submitBraveSearchWithReceipt>[0]["fetchImpl"],
  attemptKey: string | null = "brave-test-attempt",
  invocationKey: string | null = "brave-test-invocation",
) {
  return {
    query: "customer-only search phrase",
    apiKey: "brave-secret-api-key",
    count: 8,
    safesearch: "moderate" as const,
    context: {
      teamId: 42,
      operationType: "expert_discovery",
      attempt: 1,
      ...(attemptKey == null ? {} : { attemptKey }),
      ...(invocationKey == null ? {} : { invocationKey }),
    },
    fetchImpl,
    _deps: fixtureValue._deps,
  };
}

test("Brave queue redelivery reuses one physical call without an explicit stage key", async () => {
  const fixtureValue = fixture();
  let calls = 0;
  const requestOptions = options(
    fixtureValue,
    async () => {
      calls++;
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "x-request-id": "brave-redelivery-123" },
      });
    },
    null,
    null,
  );
  const identity = providerInvocationIdentityForJob("brave-search", {
    id: "queue-job-42",
    data: {},
  });

  await runWithProviderInvocationIdentity(identity, () =>
    submitBraveSearchWithReceipt(requestOptions),
  );
  await assert.rejects(
    () =>
      runWithProviderInvocationIdentity(identity, () =>
        submitBraveSearchWithReceipt(requestOptions),
      ),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(calls, 1);
});

test("Brave intentional invocation keys permit the same request twice", async () => {
  const fixtureValue = fixture();
  let calls = 0;
  const requestOptions = options(
    fixtureValue,
    async () => {
      calls++;
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "x-request-id": `brave-intentional-${calls}` },
      });
    },
    null,
    null,
  );

  for (const invocationKey of ["brave-invocation-a", "brave-invocation-b"]) {
    await runWithProviderInvocationIdentity(invocationKey, () =>
      submitBraveSearchWithReceipt(requestOptions),
    );
  }
  assert.equal(calls, 2);
  assert.equal(fixtureValue.store.rows.size, 2);
});

test("Brave receipt captures one request without query or credential metadata", async () => {
  const fixtureValue = fixture();
  let calls = 0;
  const response = await submitBraveSearchWithReceipt(
    options(fixtureValue, async (url, init) => {
      calls++;
      assert.match(url, /q=customer-only\+search\+phrase/);
      assert.match(url, /count=8/);
      assert.equal((init?.headers as Record<string, string>)["X-Subscription-Token"], "brave-secret-api-key");
      return new Response(JSON.stringify({ web: { results: [{ title: "Result" }] } }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "brave-request-123" },
      });
    }),
  );

  assert.equal(calls, 1);
  assert.equal(response.web?.results?.length, 1);
  assert.equal(fixtureValue.ledger.length, 1);
  const receipt = [...fixtureValue.store.rows.values()][0]!;
  assert.equal(receipt.requestMetadata.model, "brave-search");
  assert.equal(receipt.requestMetadata.maxRequests, 1);
  assert.equal(receipt.responseUsage?.unitType, "requests");
  assert.equal(receipt.responseUsage?.unitCount, 1);
  assert.deepEqual(receipt.responseUsage?.raw, { requestCount: 1 });
  assert.equal(receipt.providerRequestId, "brave-request-123");
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("customer-only search phrase"), false);
  assert.equal(serialized.includes("brave-secret-api-key"), false);
  assert.equal(serialized.includes("api.search.brave.com"), false);
});

test("Brave response identity is retained for an unknown non-success response", async () => {
  const fixtureValue = fixture();
  let calls = 0;
  await assert.rejects(
    submitBraveSearchWithReceipt(
      options(fixtureValue, async () => {
        calls++;
        return new Response("rate limited", {
          status: 429,
          headers: { "x-request-id": "brave-rate-limit-456" },
        });
      }),
    ),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_NOT_DURABLE",
  );

  assert.equal(calls, 1);
  assert.equal(fixtureValue.ledger.length, 0);
  const receipt = [...fixtureValue.store.rows.values()][0]!;
  assert.equal(receipt.providerRequestId, "brave-rate-limit-456");
  assert.equal(receipt.responseUsage?.known, false);
  assert.equal(receipt.responseUsage?.unitCount, null);
  assert.equal(receipt.status, "reconciliation_required");
});

test("accounting failure is terminal and cannot replay the Brave request", async () => {
  const fixtureValue = fixture();
  let calls = 0;
  let ledgerAttempts = 0;
  fixtureValue._deps.recordUsage = async () => {
    ledgerAttempts++;
    throw new Error("ledger outage");
  };

  const requestOptions = options(fixtureValue, async () => {
    calls++;
    return new Response(JSON.stringify({ web: { results: [] } }), {
      status: 200,
      headers: { "x-request-id": "brave-accounting-789" },
    });
  });
  await assert.rejects(
    submitBraveSearchWithReceipt(requestOptions),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );
  await assert.rejects(
    submitBraveSearchWithReceipt(requestOptions),
    (error: { code?: string }) => error.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(calls, 1);
  assert.equal(ledgerAttempts, 1);
});