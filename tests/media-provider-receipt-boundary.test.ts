import assert from "node:assert/strict";
import test from "node:test";

import { executePaidMediaBoundary } from "../lib/media-provider-boundary";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
} from "../lib/provider-attempt-receipts";

function receiptDependencies() {
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

function boundaryOptions(
  fixture: ReturnType<typeof receiptDependencies>,
  submit: Parameters<typeof executePaidMediaBoundary>[0]["submit"],
) {
  return {
    mediaKind: "video" as const,
    submit,
    persist: async (result: unknown) => result,
    receipt: {
      context: {
        teamId: 7,
        operationType: "veo_clip",
        provider: "gemini" as const,
        model: "veo-3.1-fast-generate-preview",
        resourceType: "social_post",
        resourceId: 42,
        attemptKey: "veo:post:42:scene:1",
      },
      request: {
        model: "veo-3.1-fast-generate-preview",
        maxDurationSeconds: 6,
        maxImages: 1,
        timeoutMs: 3_600_000,
      },
      _deps: fixture._deps,
      captureResponse: async () => ({
        providerRequestId: "operations/veo-42",
        usage: { unitType: "seconds", unitCount: 6, known: true },
        metadata: { operationId: "operations/veo-42" },
      }),
    },
  };
}

test("media receipt boundary captures usage before persistence", async () => {
  const fixture = receiptDependencies();
  let submissions = 0;
  let persisted = 0;
  const result = await executePaidMediaBoundary({
    ...boundaryOptions(fixture, async () => {
      submissions++;
      return { bytes: 1 };
    }),
    persist: async (value) => {
      persisted++;
      return value;
    },
  });

  assert.deepEqual(result, { bytes: 1 });
  assert.equal(submissions, 1);
  assert.equal(persisted, 1);
  assert.equal(fixture.ledger.length, 1);
  assert.equal((fixture.ledger[0] as { unitCount: number }).unitCount, 6);
  const [receipt] = fixture.store.rows.values();
  assert.equal(receipt?.providerRequestId, "operations/veo-42");
  assert.equal(receipt?.status, "accounted");
});

test("media receipt boundary refuses duplicate submission after delivery failure", async () => {
  const fixture = receiptDependencies();
  let submissions = 0;
  let persistCalls = 0;
  const options = boundaryOptions(fixture, async () => {
    submissions++;
    return { id: "provider-result" };
  });
  options.persist = async () => {
    persistCalls++;
    throw new Error("object storage outage");
  };

  await assert.rejects(
    executePaidMediaBoundary(options),
    (error: any) => error?.code === "PROVIDER_RESULT_NOT_DURABLE",
  );
  assert.equal(submissions, 1);
  assert.equal(persistCalls, 1);
  assert.equal(fixture.ledger.length, 1);

  await assert.rejects(
    executePaidMediaBoundary({
      ...options,
      persist: async () => "unexpected replay",
    }),
    (error: any) => error?.code === "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  assert.equal(submissions, 1);
  assert.equal(fixture.ledger.length, 1);
});

test("media receipt ownership rejection happens before physical submission", async () => {
  const fixture = receiptDependencies();
  let submissions = 0;
  fixture._deps.validateOwnership = async () => {
    throw new Error("media resource is not owned by team");
  };

  await assert.rejects(
    executePaidMediaBoundary(
      boundaryOptions(fixture, async () => {
        submissions++;
        return "must-not-submit";
      }),
    ),
    /not owned/,
  );
  assert.equal(submissions, 0);
  assert.equal(fixture.store.rows.size, 0);
});