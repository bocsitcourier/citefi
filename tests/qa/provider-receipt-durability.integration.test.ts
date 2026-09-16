/**
 * Production receipt durability QA.
 *
 * Run only against the disposable fixture (never an application database):
 *
 *   QA/support/with-isolated-database.sh -- tests/qa/provider-receipt-durability.integration.test.ts
 *
 * The suite fails closed unless the harness sets QA_ISOLATED_DATABASE=true.
 * It uses no provider SDK or network transport; the provider is a counting
 * in-process stub and receipt objects use a real temporary filesystem
 * transport behind the production object-spool adapter.
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";

import { eq, inArray } from "drizzle-orm";

import { closeDb, systemDb } from "../../lib/db";
import {
  createProviderAttemptObjectSpool,
} from "../../lib/provider-attempt-object-spool";
import * as receipts from "../../lib/provider-attempt-receipts";
import { recordProviderUsage } from "../../lib/provider-usage-ledger";
import {
  runWithBlockedDatabaseContext,
  runWithSystemContext,
  runWithTenantContext,
} from "../../lib/tenant-context";
import {
  providerAttemptReceipts,
  providerUsageLedger,
  teamMembers,
  teams,
} from "../../shared/schema";

if (
  !process.env.DATABASE_URL ||
  process.env.QA_ISOLATED_DATABASE !== "true"
) {
  throw new Error(
    "provider receipt durability QA requires QA/support/with-isolated-database.sh",
  );
}

type TenantFixture = {
  teamId: number;
  userId: number;
  role: string;
};

type FilesystemObjectStorage = {
  bucket: () => {
    file: (key: string) => {
      save: (
        data: Buffer,
        options?: {
          contentType?: string;
          metadata?: Record<string, string>;
        },
      ) => Promise<void>;
      createReadStream: () => NodeJS.ReadableStream;
      delete: () => Promise<void>;
    };
  };
};

const fixtureNames = [
  "QA Isolated Tenant A",
  "QA Isolated Tenant B",
] as const;

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let spoolRoot: string;
const scenarioSpoolRoots = new Set<string>();

function filesystemObjectStorage(root: string): FilesystemObjectStorage {
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

function localSpool(root = spoolRoot) {
  return createProviderAttemptObjectSpool({
    serialize: receipts.serializeProviderAttemptReceiptSpoolRecord,
    parse: receipts.validateProviderAttemptReceiptSpoolRecord,
    storage: filesystemObjectStorage(root),
    bucketName: "qa-local-provider-receipts",
  });
}

function tenantContext<T>(
  tenant: TenantFixture,
  callback: () => T,
): T {
  return runWithTenantContext(
    {
      actorType: "web",
      userId: tenant.userId,
      teamId: tenant.teamId,
      role: tenant.role,
    },
    callback,
  );
}

function attemptFixture(
  tenant: TenantFixture,
  attemptKey: string,
): {
  context: receipts.ProviderAttemptContext;
  request: receipts.SafeProviderRequest;
} {
  const context: receipts.ProviderAttemptContext = {
    teamId: tenant.teamId,
    userId: tenant.userId,
    invocationKey: `qa-provider-receipt-durability:${attemptKey}`,
    operationType: "qa_receipt_durability",
    provider: "brave",
    model: "qa-unpriced-receipt-model-v1",
    attemptKey,
  };
  const request: receipts.SafeProviderRequest = {
    model: context.model,
    maxRequests: 1,
    timeoutMs: 2_000,
    adapterVersion: "qa-receipt-durability-v1",
  };
  return { context, request };
}

function sourceEventIdFor(
  fixture: ReturnType<typeof attemptFixture>,
): string {
  return receipts.deterministicProviderAttemptSourceEventId(
    fixture.context,
    fixture.request,
  );
}

async function readPrimaryReceipt(sourceEventId: string) {
  return runWithSystemContext(
    "provider receipt durability QA: inspect fixture receipt",
    async () => {
      const [row] = await systemDb
        .select()
        .from(providerAttemptReceipts)
        .where(eq(providerAttemptReceipts.sourceEventId, sourceEventId))
        .limit(1);
      return row ?? null;
    },
  );
}

async function countPrimaryReceipts(sourceEventId: string) {
  return runWithSystemContext(
    "provider receipt durability QA: count fixture receipts",
    async () => {
      const rows = await systemDb
        .select({ id: providerAttemptReceipts.id })
        .from(providerAttemptReceipts)
        .where(eq(providerAttemptReceipts.sourceEventId, sourceEventId));
      return rows.length;
    },
  );
}

async function readLedgerEvent(sourceEventId: string) {
  return runWithSystemContext(
    "provider receipt durability QA: inspect fixture ledger",
    async () => {
      const [row] = await systemDb
        .select()
        .from(providerUsageLedger)
        .where(eq(providerUsageLedger.sourceEventId, sourceEventId))
        .limit(1);
      return row ?? null;
    },
  );
}

async function countLedgerEvents(sourceEventId: string) {
  return runWithSystemContext(
    "provider receipt durability QA: count fixture ledger events",
    async () => {
      const rows = await systemDb
        .select({ id: providerUsageLedger.id })
        .from(providerUsageLedger)
        .where(eq(providerUsageLedger.sourceEventId, sourceEventId));
      return rows.length;
    },
  );
}

async function writeWrongIdentitySpoolObject(
  root: string,
  expectedSourceEventId: string,
): Promise<void> {
  const valid = await localSpool(root).read(expectedSourceEventId);
  assert.ok(valid);
  const wrongSourceEventId = `provider-attempt:wrong-identity-${expectedSourceEventId.slice("provider-attempt:".length)}`;
  const path = join(
    root,
    "private",
    "provider-attempt-receipts",
    `${expectedSourceEventId}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    receipts.serializeProviderAttemptReceiptSpoolRecord({
      ...valid,
      sourceEventId: wrongSourceEventId,
    }),
    "utf8",
  );
}

type RecoveryScenario = {
  sourceEventId: string;
  spoolRoot: string;
  providerCalls: () => number;
  ledgerAttemptsBeforeRecovery: number;
};

async function runRecoveryScenario(attemptKey: string): Promise<RecoveryScenario> {
  const scenarioRoot = await mkdtemp(join(tmpdir(), "citefi-provider-receipt-"));
  scenarioSpoolRoots.add(scenarioRoot);
  const fixture = attemptFixture(tenantA, attemptKey);
  const sourceEventId = sourceEventIdFor(fixture);
  const spool = localSpool(scenarioRoot);
  let providerCalls = 0;
  let ledgerAttempts = 0;

  const submit = async ({
    captureResponse,
  }: receipts.ProviderAttemptHandle): Promise<string> => {
    providerCalls++;
    /*
     * This is the narrow fault injection: the provider has returned exact
     * usage, but the receipt DB capture runs in a blocked DB context.
     * The production state machine must fall back to the durable spool.
     */
    await runWithBlockedDatabaseContext(
      "QA injected receipt-capture database fault",
      () =>
        captureResponse({
          providerRequestId: `qa-recovery-provider-request-${attemptKey}`,
          usage: {
            unitType: "requests",
            unitCount: 3,
            inputUnits: 2,
            outputUnits: 1,
            known: true,
          },
          metadata: {
            providerRequestId: `qa-recovery-provider-request-${attemptKey}`,
            httpStatus: 200,
          },
        }),
    );
    return "qa-provider-response";
  };

  const firstRecordUsage = async (
    input: Parameters<typeof recordProviderUsage>[0],
  ) => {
    ledgerAttempts++;
    if (ledgerAttempts === 1) {
      throw new Error("QA injected immutable-ledger outage");
    }
    return recordProviderUsage(input);
  };

  await assert.rejects(
    tenantContext(tenantA, () =>
      receipts.runWithProviderAttempt({
        context: fixture.context,
        request: fixture.request,
        submit,
        _deps: {
          spool,
          recordUsage: firstRecordUsage,
        },
      }),
    ),
    (error: unknown) =>
      (error as { code?: unknown } | null)?.code ===
      "PROVIDER_ATTEMPT_ACCOUNTING_FAILED",
  );

  assert.equal(providerCalls, 1);
  assert.equal(ledgerAttempts, 1);

  /*
   * Recreate the production spool adapter after the simulated restart.
   * The second adapter has no process-local state and must recover the
   * provider response from the temporary filesystem object transport.
   */
  const restartedSpool = localSpool(scenarioRoot);
  const recoveredObject = await restartedSpool.read(sourceEventId);
  assert.ok(recoveredObject);
  assert.equal(recoveredObject.status, "usage_captured");
  assert.equal(
    recoveredObject.providerRequestId,
    `qa-recovery-provider-request-${attemptKey}`,
  );
  assert.deepEqual(recoveredObject.responseUsage, {
    unitType: "requests",
    unitCount: 3,
    inputUnits: 2,
    outputUnits: 1,
    known: true,
  });

  const failedPrimary = await readPrimaryReceipt(sourceEventId);
  assert.ok(failedPrimary);
  assert.equal(failedPrimary.status, "accounting_failed");
  assert.equal(
    failedPrimary.responseUsage,
    null,
    "DB capture was the injected fault; spool remains the response evidence",
  );

  const recovered = await tenantContext(tenantA, () =>
    receipts.reconcileProviderAttempt(
      { sourceEventId },
      { spool: restartedSpool },
    ),
  );
  assert.equal(recovered.receipt.status, "accounted");
  assert.equal(recovered.receipt.responseUsage?.unitCount, 3);
  assert.equal(providerCalls, 1, "reconciliation cannot invoke the provider");
  assert.equal(ledgerAttempts, 1, "recovery uses the real ledger, not the fault seam");

  const ledger = await readLedgerEvent(sourceEventId);
  assert.ok(ledger);
  assert.equal(await countLedgerEvents(sourceEventId), 1);
  assert.equal(ledger.eventType, "usage");
  assert.equal(ledger.unitType, "requests");
  assert.equal(ledger.unitCount, 3);
  assert.equal(ledger.inputUnits, 2);
  assert.equal(ledger.outputUnits, 1);
  assert.equal(
    ledger.providerRequestId,
    `qa-recovery-provider-request-${attemptKey}`,
  );
  assert.equal(ledger.rateVersionId, null);
  assert.equal(ledger.providerRateId, null);
  assert.deepEqual(ledger.rateSnapshot, {
    version: "unpriced",
    reason: "No locked provider rate matched this model/unit at occurredAt",
  });
  assert.equal(
    ledger.costMicrousd,
    0,
    "unpriced is explicit evidence, not fabricated free pricing",
  );

  const accountedPrimary = await readPrimaryReceipt(sourceEventId);
  assert.ok(accountedPrimary);
  assert.equal(await countPrimaryReceipts(sourceEventId), 1);
  assert.equal(accountedPrimary.status, "accounted");
  assert.deepEqual(accountedPrimary.responseUsage, {
    unitType: "requests",
    unitCount: 3,
    inputUnits: 2,
    outputUnits: 1,
    known: true,
  });
  assert.equal(
    accountedPrimary.providerRequestId,
    `qa-recovery-provider-request-${attemptKey}`,
  );

  const accountedObject = await restartedSpool.read(sourceEventId);
  assert.equal(accountedObject?.status, "accounted");
  assert.equal(accountedObject?.providerRequestId, accountedPrimary.providerRequestId);
  assert.deepEqual(accountedObject?.responseUsage, accountedPrimary.responseUsage);

  /*
   * Reconcile from a recreated adapter once more.  This is the service
   * restart/idempotency proof: one physical provider submission and one
   * immutable ledger event remain after recovery.
   */
  const secondRestartSpool = localSpool(scenarioRoot);
  const replayedRecovery = await tenantContext(tenantA, () =>
    receipts.reconcileProviderAttempt(
      { sourceEventId },
      { spool: secondRestartSpool },
    ),
  );
  assert.equal(replayedRecovery.receipt.status, "accounted");
  assert.equal(providerCalls, 1);
  const ledgerAfterReplay = await readLedgerEvent(sourceEventId);
  assert.equal(ledgerAfterReplay?.id, ledger.id);
  assert.equal(await countLedgerEvents(sourceEventId), 1);

  return {
    sourceEventId,
    spoolRoot: scenarioRoot,
    providerCalls: () => providerCalls,
    ledgerAttemptsBeforeRecovery: ledgerAttempts,
  };
}

before(async () => {
  spoolRoot = await mkdtemp(join(tmpdir(), "citefi-provider-receipt-"));
  const fixtureRows = await runWithSystemContext(
    "provider receipt durability QA: discover harness tenants",
    async () => {
      const rows = await systemDb
        .select({
          id: teams.id,
          name: teams.name,
        })
        .from(teams)
        .where(inArray(teams.name, [...fixtureNames]));
      const result = new Map<string, TenantFixture>();
      for (const row of rows) {
        const [member] = await systemDb
          .select({
            userId: teamMembers.userId,
            role: teamMembers.role,
          })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, row.id))
          .limit(1);
        if (member) {
          result.set(row.name, {
            teamId: row.id,
            userId: member.userId,
            role: member.role,
          });
        }
      }
      return result;
    },
  );
  const discoveredA = fixtureRows.get(fixtureNames[0]);
  const discoveredB = fixtureRows.get(fixtureNames[1]);
  if (!discoveredA || !discoveredB) {
    throw new Error(
      "isolated harness tenant fixtures A and B were not found; refusing non-fixture writes",
    );
  }
  tenantA = discoveredA;
  tenantB = discoveredB;
});

after(async () => {
  await closeDb();
  if (spoolRoot) await rm(spoolRoot, { recursive: true, force: true });
  await Promise.all(
    [...scenarioSpoolRoots].map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

test("production DB receipt store and CAS admit one physical concurrent submission", async () => {
  const fixture = attemptFixture(tenantA, "concurrent-same-identity");
  const sourceEventId = sourceEventIdFor(fixture);
  const spool = localSpool();
  let providerCalls = 0;
  let firstSubmissionStarted!: () => void;
  let releaseFirstSubmission!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    firstSubmissionStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseFirstSubmission = resolve;
  });

  const submit = async ({
    captureResponse,
  }: receipts.ProviderAttemptHandle): Promise<string> => {
    providerCalls++;
    if (providerCalls === 1) {
      firstSubmissionStarted();
      await release;
    }
    await captureResponse({
      providerRequestId: "qa-concurrent-provider-request",
      usage: {
        unitType: "requests",
        unitCount: 1,
        inputUnits: 1,
        outputUnits: 0,
        known: true,
      },
    });
    return "qa-concurrent-response";
  };

  const first = tenantContext(tenantA, () =>
    receipts.runWithProviderAttempt({
      context: fixture.context,
      request: fixture.request,
      submit,
      _deps: { spool },
    }),
  );
  await firstStarted;
  const second = tenantContext(tenantA, () =>
    receipts.runWithProviderAttempt({
      context: fixture.context,
      request: fixture.request,
      submit,
      _deps: { spool },
    }),
  );
  await Promise.resolve();
  releaseFirstSubmission();

  const results = await Promise.allSettled([first, second]);
  assert.equal(providerCalls, 1);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        (result.reason as { code?: unknown } | null)?.code ===
          "PROVIDER_ATTEMPT_ALREADY_SUBMITTED",
    ).length,
    1,
  );

  const receipt = await readPrimaryReceipt(sourceEventId);
  assert.ok(receipt);
  assert.equal(await countPrimaryReceipts(sourceEventId), 1);
  assert.equal(receipt.teamId, tenantA.teamId);
  assert.equal(receipt.status, "accounted");
  assert.deepEqual(receipt.responseUsage, {
    unitType: "requests",
    unitCount: 1,
    inputUnits: 1,
    outputUnits: 0,
    known: true,
  });

  const ledger = await readLedgerEvent(sourceEventId);
  assert.ok(ledger);
  assert.equal(await countLedgerEvents(sourceEventId), 1);
  assert.equal(ledger.unitCount, 1);
  assert.equal(ledger.providerRequestId, "qa-concurrent-provider-request");
  assert.equal(ledger.rateVersionId, null);
  assert.equal(ledger.providerRateId, null);
  assert.deepEqual(ledger.rateSnapshot, {
    version: "unpriced",
    reason: "No locked provider rate matched this model/unit at occurredAt",
  });
});

test("DB capture and ledger faults recover from a recreated spool without replay", async () => {
  const scenario = await runRecoveryScenario(
    "response-capture-and-ledger-failure",
  );
  assert.equal(scenario.providerCalls(), 1);
  assert.equal(scenario.ledgerAttemptsBeforeRecovery, 1);

  /*
   * Exercise the accounted fast path after a stale object was left behind by
   * an older service instance.  The primary DB row is already canonical; a
   * recreated adapter must heal the stale spool without a provider call or a
   * second ledger event.
   */
  const staleSpool = localSpool(scenario.spoolRoot);
  const canonical = await staleSpool.read(scenario.sourceEventId);
  assert.ok(canonical);
  await staleSpool.write({
    ...canonical,
    status: "usage_captured",
    accountedAt: null,
  });
  const recreatedAfterStale = localSpool(scenario.spoolRoot);
  const healed = await tenantContext(tenantA, () =>
    receipts.reconcileProviderAttempt(
      { sourceEventId: scenario.sourceEventId },
      { spool: recreatedAfterStale },
    ),
  );
  assert.equal(healed.receipt.status, "accounted");
  assert.equal(scenario.providerCalls(), 1);
  assert.equal(await countLedgerEvents(scenario.sourceEventId), 1);
  const healedPrimary = await readPrimaryReceipt(scenario.sourceEventId);
  assert.equal(healedPrimary?.status, "accounted");
  assert.ok(healedPrimary?.responseUsage);
  const healedObject = await recreatedAfterStale.read(scenario.sourceEventId);
  assert.equal(healedObject?.status, "accounted");
  assert.equal(healedObject?.providerRequestId, healedPrimary?.providerRequestId);
  assert.deepEqual(healedObject?.responseUsage, healedPrimary?.responseUsage);
});

test("tenant RLS rejects another tenant's receipt during recovery", async () => {
  const scenario = await runRecoveryScenario(
    "cross-tenant-independent-recovery",
  );
  const ledgerBefore = await readLedgerEvent(scenario.sourceEventId);
  const spoolBefore = await localSpool(scenario.spoolRoot).read(
    scenario.sourceEventId,
  );
  assert.ok(ledgerBefore);
  assert.ok(spoolBefore);

  await assert.rejects(
    tenantContext(tenantB, () =>
      receipts.reconcileProviderAttempt(
        { sourceEventId: scenario.sourceEventId },
        { spool: localSpool(scenario.spoolRoot) },
      ),
    ),
    /teamId does not match validated tenant/,
  );
  assert.equal(
    scenario.providerCalls(),
    1,
    "cross-tenant recovery must not invoke the provider",
  );
  assert.equal(await countLedgerEvents(scenario.sourceEventId), 1);
  assert.equal((await readLedgerEvent(scenario.sourceEventId))?.id, ledgerBefore.id);
  assert.deepEqual(
    await localSpool(scenario.spoolRoot).read(scenario.sourceEventId),
    spoolBefore,
    "cross-tenant denial must not mutate the shared spool",
  );

  /*
   * A source-key object containing a different receipt identity is rejected
   * before reconciliation.  This is the object-transport contract boundary,
   * not a substitute for tenant RLS.
   */
  await writeWrongIdentitySpoolObject(
    scenario.spoolRoot,
    scenario.sourceEventId,
  );
  await assert.rejects(
    tenantContext(tenantA, () =>
      receipts.reconcileProviderAttempt(
        { sourceEventId: scenario.sourceEventId },
        { spool: localSpool(scenario.spoolRoot) },
      ),
    ),
    (error: unknown) =>
      (error as { code?: unknown } | null)?.code ===
      "PROVIDER_ATTEMPT_NOT_DURABLE",
  );
  assert.equal(scenario.providerCalls(), 1);
  assert.equal(await countLedgerEvents(scenario.sourceEventId), 1);
});