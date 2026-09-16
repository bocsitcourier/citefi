/**
 * Safe-local measured load for the production provider-attempt receipt/CAS
 * path.  This deliberately uses the production receipt state machine with its
 * in-memory test store and a local filesystem object-spool adapter.  It never
 * opens PostgreSQL, an application Redis, a provider SDK, or an external
 * socket.
 *
 * Run through QA/support/load-local.sh.  The output is deliberately
 * machine-readable so the evidence file can distinguish measurements from
 * capacity forecasts.
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import {
  createProviderAttemptObjectSpool,
} from "../../lib/provider-attempt-object-spool";
import {
  MemoryProviderAttemptReceiptSpool,
  MemoryProviderAttemptReceiptStore,
  ProviderAttemptAlreadySubmittedError,
  reconcileProviderAttempt,
  runWithProviderAttempt,
  serializeProviderAttemptReceiptSpoolRecord,
  validateProviderAttemptReceiptSpoolRecord,
  type ProviderAttemptContext,
  type ProviderAttemptReceiptSpool,
  type ProviderAttemptReceiptStore,
} from "../../lib/provider-attempt-receipts";
import type { ProviderUsageInput } from "../../lib/provider-usage-ledger";

if (process.env.QA_LOAD_SAFE_LOCAL !== "true") {
  throw new Error(
    "load receipt QA requires QA/support/load-local.sh (safe-local guard)",
  );
}
if (process.env.QA_LOAD_NO_DATABASE !== "true") {
  throw new Error("load receipt QA must explicitly run in no-database mode");
}

const MODEL = "qa-load-stub-model-v1";
const REQUEST = {
  model: MODEL,
  maxRequests: 1,
  timeoutMs: 2_000,
  adapterVersion: "qa-load-v1",
} as const;

type LedgerRow = ProviderUsageInput & { recordedAt: number };

type LoadMeasurement = {
  workload: "same_identity" | "unique_identity";
  concurrency: number;
  durationMs: number;
  p50Ms: number;
  p95Ms: number;
  throughputRequestsPerSecond: number;
  logicalRequests: number;
  successfulRequests: number;
  errors: number;
  expectedErrors: number;
  unexpectedErrors: number;
  providerPhysicalCalls: number;
  ledgerCount: number;
  receiptCount: number;
  accountedReceiptCount: number;
  rssBeforeBytes: number;
  rssAfterBytes: number;
  rssDeltaBytes: number;
  heapUsedBeforeBytes: number;
  heapUsedAfterBytes: number;
  heapUsedDeltaBytes: number;
};

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
  };
}

function percentile(values: number[], fraction: number): number {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index]!;
}

async function waitFor(
  condition: () => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() >= deadline) {
      throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function contextFor(key: string): ProviderAttemptContext {
  return {
    teamId: 7,
    invocationKey: `qa-load-invocation:${key}`,
    runId: `qa-load-run:${key}`,
    jobId: `qa-load-job:${key}`,
    operationType: "qa_receipt_load",
    provider: "brave",
    model: MODEL,
    attemptKey: key,
    attempt: 1,
  };
}

function makeLedgerRecorder(
  ledger: Map<string, LedgerRow>,
  onRecord?: (input: ProviderUsageInput) => Promise<void>,
) {
  return async (input: ProviderUsageInput): Promise<{ sourceEventId: string }> => {
    if (onRecord) await onRecord(input);
    // This models the immutable source-event uniqueness of the production
    // ledger without pretending that an in-memory count is a database count.
    const sourceEventId = input.sourceEventId;
    if (!sourceEventId) {
      throw new Error("load ledger recorder requires a deterministic sourceEventId");
    }
    ledger.set(sourceEventId, {
      ...input,
      recordedAt: Date.now(),
    });
    return { sourceEventId };
  };
}

async function runReceiptRequest(args: {
  context: ProviderAttemptContext;
  store: ProviderAttemptReceiptStore;
  spool: ProviderAttemptReceiptSpool;
  physicalCalls: { value: number };
  recordUsage: (input: ProviderUsageInput) => Promise<unknown>;
  providerBarrier?: Promise<void>;
}): Promise<string> {
  return runWithProviderAttempt({
    context: args.context,
    request: REQUEST,
    submit: async ({ receipt, captureResponse }) => {
      args.physicalCalls.value += 1;
      if (args.providerBarrier) await args.providerBarrier;
      await captureResponse({
        providerRequestId: `qa-stub-request-${receipt.sourceEventId.slice(-32)}`,
        usage: {
          unitType: "requests",
          unitCount: 1,
          inputUnits: 1,
          outputUnits: 0,
          known: true,
        },
        metadata: {
          actualModel: MODEL,
          httpStatus: 200,
        },
      });
      return "qa-provider-stub-response";
    },
    _deps: {
      store: args.store,
      spool: args.spool,
      validateOwnership: async () => undefined,
      recordUsage: args.recordUsage,
    },
  });
}

async function runLoadCase(
  workload: "same_identity" | "unique_identity",
  concurrency: number,
): Promise<LoadMeasurement> {
  const store = new MemoryProviderAttemptReceiptStore();
  const spool = new MemoryProviderAttemptReceiptSpool();
  const ledger = new Map<string, LedgerRow>();
  const physicalCalls = { value: 0 };
  const rssBefore = memorySnapshot();
  const latencies: number[] = [];
  let releaseProvider!: () => void;
  const providerBarrier = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const recordUsage = makeLedgerRecorder(ledger);
  const sharedKey = `same-${concurrency}`;
  const startedAt = performance.now();

  const requests = Array.from({ length: concurrency }, (_, index) => {
    const key =
      workload === "same_identity"
        ? sharedKey
        : `unique-${concurrency}-${index}`;
    const started = performance.now();
    const request = runReceiptRequest({
      context: contextFor(key),
      store,
      spool,
      physicalCalls,
      recordUsage,
      providerBarrier: workload === "same_identity" ? providerBarrier : undefined,
    }).then(
      (result) => {
        latencies.push(performance.now() - started);
        return { ok: true as const, result };
      },
      (error: unknown) => {
        latencies.push(performance.now() - started);
        return { ok: false as const, error };
      },
    );
    return request;
  });

  if (workload === "same_identity") {
    await waitFor(
      () => physicalCalls.value === 1,
      `CAS provider stub for ${concurrency} concurrent requests`,
    );
    releaseProvider();
  }
  const results = await Promise.all(requests);
  const durationMs = performance.now() - startedAt;
  const errors = results.filter((result) => !result.ok);
  const expectedErrors = errors.filter(
    (result) =>
      result.error instanceof ProviderAttemptAlreadySubmittedError ||
      (result.error as { code?: unknown } | null)?.code ===
        "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
  );
  const rssAfter = memorySnapshot();
  const expectedPhysicalCalls = workload === "same_identity" ? 1 : concurrency;
  const expectedLedgerCount = expectedPhysicalCalls;

  assert.equal(
    physicalCalls.value,
    expectedPhysicalCalls,
    `${workload}/${concurrency}: physical provider submissions`,
  );
  assert.equal(
    ledger.size,
    expectedLedgerCount,
    `${workload}/${concurrency}: immutable ledger projection count`,
  );
  assert.equal(
    store.rows.size,
    expectedLedgerCount,
    `${workload}/${concurrency}: receipt CAS row count`,
  );
  assert.equal(
    [...store.rows.values()].filter((row) => row.status === "accounted").length,
    expectedLedgerCount,
    `${workload}/${concurrency}: all physical attempts accounted`,
  );
  assert.equal(
    errors.length,
    workload === "same_identity" ? concurrency - 1 : 0,
    `${workload}/${concurrency}: logical request errors`,
  );
  assert.equal(
    expectedErrors.length,
    errors.length,
    `${workload}/${concurrency}: all duplicate errors must be explicit CAS refusals`,
  );
  assert.equal(
    spool.rows.size,
    expectedLedgerCount,
    `${workload}/${concurrency}: spool convergence count`,
  );

  return {
    workload,
    concurrency,
    durationMs,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    throughputRequestsPerSecond: concurrency / Math.max(durationMs / 1_000, 0.000001),
    logicalRequests: concurrency,
    successfulRequests: results.length - errors.length,
    errors: errors.length,
    expectedErrors: expectedErrors.length,
    unexpectedErrors: errors.length - expectedErrors.length,
    providerPhysicalCalls: physicalCalls.value,
    ledgerCount: ledger.size,
    receiptCount: store.rows.size,
    accountedReceiptCount: [...store.rows.values()].filter(
      (row) => row.status === "accounted",
    ).length,
    rssBeforeBytes: rssBefore.rss,
    rssAfterBytes: rssAfter.rss,
    rssDeltaBytes: rssAfter.rss - rssBefore.rss,
    heapUsedBeforeBytes: rssBefore.heapUsed,
    heapUsedAfterBytes: rssAfter.heapUsed,
    heapUsedDeltaBytes: rssAfter.heapUsed - rssBefore.heapUsed,
  };
}

type LocalObjectStorage = {
  bucket: () => {
    file: (key: string) => {
      save: (data: Buffer) => Promise<void>;
      createReadStream: () => NodeJS.ReadableStream;
      delete: () => Promise<void>;
    };
  };
};

function localObjectStorage(root: string): LocalObjectStorage {
  return {
    bucket: () => ({
      file: (key) => {
        const path = join(root, key);
        return {
          async save(data) {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, data);
          },
          createReadStream() {
            return createReadStream(path);
          },
          async delete() {
            await rm(path, { force: true });
          },
        };
      },
    }),
  };
}

function filesystemSpool(root: string): ProviderAttemptReceiptSpool {
  return createProviderAttemptObjectSpool({
    storage: localObjectStorage(root),
    bucketName: "qa-local-load-receipts",
    serialize: serializeProviderAttemptReceiptSpoolRecord,
    parse: validateProviderAttemptReceiptSpoolRecord,
  });
}

async function runFaultScenarios(): Promise<void> {
  // Storage unavailable before admission: the production state machine must
  // refuse the provider call rather than treating a prepared row as durable.
  {
    const store = new MemoryProviderAttemptReceiptStore();
    const spool = new MemoryProviderAttemptReceiptSpool();
    spool.failWrite = true;
    const physicalCalls = { value: 0 };
    await assert.rejects(
      runReceiptRequest({
        context: contextFor("fault-pre-admission-storage"),
        store,
        spool,
        physicalCalls,
        recordUsage: makeLedgerRecorder(new Map()),
      }),
      (error: unknown) =>
        (error as { code?: unknown } | null)?.code ===
        "PROVIDER_ATTEMPT_NOT_DURABLE",
    );
    assert.equal(physicalCalls.value, 0, "pre-admission spool fault must block provider");
  }

  // Post-provider ledger failure: capture one provider response, fail the
  // immutable ledger, then reopen the local object spool and reconcile.  This
  // is the crash boundary after a physical provider response, not a copied
  // source-level model.
  {
    const store = new MemoryProviderAttemptReceiptStore();
    const root = await mkdtemp(join(tmpdir(), "citefi-load-ledger-fault-"));
    const spool = filesystemSpool(root);
    const ledger = new Map<string, LedgerRow>();
    const physicalCalls = { value: 0 };
    let ledgerAttempts = 0;
    const recordUsage = makeLedgerRecorder(ledger, async () => {
      ledgerAttempts += 1;
      store.failStatus = true;
      throw new Error("QA injected post-provider ledger outage");
    });
    await assert.rejects(
      runReceiptRequest({
        context: contextFor("fault-post-provider-ledger"),
        store,
        spool,
        physicalCalls,
        recordUsage,
      }),
      (error: unknown) =>
        (error as { code?: unknown } | null)?.code ===
        "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
    );
    assert.equal(physicalCalls.value, 1);
    assert.equal(ledgerAttempts, 1);
    assert.equal(
      (await spool.read([...store.rows.keys()][0]!))?.status,
      "accounting_failed",
    );

    // A new adapter represents the post-crash process; object contents are the
    // only state carried across that boundary.
    store.failStatus = false;
    const restartedSpool = filesystemSpool(root);
    const sourceEventId = [...store.rows.keys()][0]!;
    const recovered = await reconcileProviderAttempt(
      { sourceEventId },
      {
        store,
        spool: restartedSpool,
        validateOwnership: async () => undefined,
        recordUsage: makeLedgerRecorder(ledger),
      },
    );
    assert.equal(recovered.receipt.status, "accounted");
    assert.equal(physicalCalls.value, 1, "reconciliation must not replay provider");
    assert.equal(ledger.size, 1);
    assert.equal((await restartedSpool.read(sourceEventId))?.status, "accounted");
    await rm(root, { recursive: true, force: true });
  }

  // Primary receipt response-write failure: the real capture path falls back
  // to the independent storage adapter; recovery then converges the primary
  // row and ledger without a second physical call.
  {
    const store = new MemoryProviderAttemptReceiptStore();
    const root = await mkdtemp(join(tmpdir(), "citefi-load-storage-fault-"));
    const spool = filesystemSpool(root);
    const ledger = new Map<string, LedgerRow>();
    const physicalCalls = { value: 0 };
    store.failCapture = true;
    await runReceiptRequest({
      context: contextFor("fault-primary-response-storage"),
      store,
      spool,
      physicalCalls,
      recordUsage: makeLedgerRecorder(ledger),
    });
    assert.equal(physicalCalls.value, 1);
    store.failCapture = false;
    const sourceEventId = [...store.rows.keys()][0]!;
    const recovered = await reconcileProviderAttempt(
      { sourceEventId },
      {
        store,
        spool: filesystemSpool(root),
        validateOwnership: async () => undefined,
        recordUsage: makeLedgerRecorder(ledger),
      },
    );
    assert.equal(recovered.receipt.status, "accounted");
    assert.equal(physicalCalls.value, 1);
    assert.equal(ledger.size, 1);
    assert.equal((await spool.read(sourceEventId))?.status, "accounted");
    await rm(root, { recursive: true, force: true });
  }
}

test("measured 1/10/100 receipt CAS load is safe-local and bounded", async () => {
  const measurements: LoadMeasurement[] = [];
  for (const concurrency of [1, 10, 100]) {
    measurements.push(await runLoadCase("same_identity", concurrency));
    measurements.push(await runLoadCase("unique_identity", concurrency));
  }
  await runFaultScenarios();
  console.log(
    `LOAD_RESULT ${JSON.stringify({
      kind: "production-provider-receipt-cas",
      mode: "memory-primary+local-filesystem-spool",
      database: "not-used",
      provider: "stub-only",
      measurements,
      faultScenarios: [
        "pre-admission-storage-fault",
        "post-provider-ledger-fault+reopened-spool",
        "primary-response-storage-fault+reconciliation",
      ],
    })}`,
  );
});