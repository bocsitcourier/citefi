import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Keep these deterministic and DB-free: database integration is exercised by
// the migration/RLS suite, while these cover the accounting contracts.
process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
const ledger = await import("../lib/provider-usage-ledger");

test("provider request source IDs are retry-idempotent", () => {
  const input = { provider: "openai", providerRequestId: "req_123", operationType: "other", model: "gpt-4o", unitType: "tokens", unitCount: 3, costMicrousd: 12 };
  assert.equal(ledger.deterministicProviderUsageSourceEventId(input, 1), ledger.deterministicProviderUsageSourceEventId({ ...input, runId: "changed" }, 1));
});

test("corrections and refunds net signed costs", () => {
  assert.equal(ledger.netProviderLedgerCosts([{ costMicrousd: 100 }, { costMicrousd: -25 }, { costMicrousd: -75 }]), 0);
  assert.throws(() => ledger.validateAdjustmentCost("refund", 1));
});

test("adjustments retain the exact original rate snapshot", () => {
  const snapshot = { version: "locked", outputMicrousdPerMillion: 2_500_000 };
  assert.equal(ledger.adjustmentRateSnapshot(snapshot), snapshot);
});

test("locked historical rates calculate costs instead of trusting mutable caller estimates", () => {
  assert.equal(
    ledger.lockedRateCostMicrousd(
      { inputUnits: 1_000, outputUnits: 500, unitCount: 1_500, costMicrousd: 999_999 },
      { input: 300_000, output: 2_500_000, perUnit: null }
    ),
    1_550
  );
  assert.equal(
    ledger.lockedRateCostMicrousd(
      { unitCount: 2, costMicrousd: 999_999 },
      { perUnit: 40_000 }
    ),
    80_000
  );
  assert.equal(
    ledger.lockedRateCostMicrousd(
      { unitCount: 1, costMicrousd: 999_999 },
      null
    ),
    0
  );
});

test("reconciliation reports exact invoice variance", () => {
  assert.deepEqual(ledger.reconciliationMismatch(100, 125), { ledgerCostMicrousd: 100, invoicedCostMicrousd: 125, varianceMicrousd: 25, matches: false });
  assert.throws(() => ledger.reconciliationMismatch(Number.MAX_SAFE_INTEGER, -1), /safe integer/);
  assert.throws(() => ledger.validateAdjustmentCost("correction", Number.MAX_SAFE_INTEGER + 1), /safe integer/);
  assert.throws(
    () => ledger.lockedRateCostMicrousd(
      { unitCount: Number.MAX_SAFE_INTEGER, costMicrousd: 0 },
      { perUnit: 2 }
    ),
    /safe integer/
  );
});

test("migration enforces append-only tenant COGS scope", () => {
  const migration = readFileSync("migrations/0017_provider_usage_ledger.sql", "utf8");
  assert.match(migration, /BEFORE UPDATE OR DELETE ON provider_usage_ledger/);
  assert.match(migration, /NOT citefi_rls\.is_client_viewer\(\)/);
  assert.match(migration, /parent_team_id=citefi_rls\.current_team_id\(\)/);
  assert.match(migration, /'brave','web-search','requests',5000/);
  assert.match(migration, /'gpt-4o-mini-tts','characters',15/);
});

test("provider monetary schema and migrations use numeric-mode bigint", () => {
  const cleanInstall = readFileSync("migrations/0017_provider_usage_ledger.sql", "utf8");
  const upgrade = readFileSync("migrations/0018_provider_monetary_bigint.sql", "utf8");
  const schema = readFileSync("shared/schema.ts", "utf8");
  const runner = readFileSync("scripts/migrate-t153-provider-usage-ledger.ts", "utf8");
  const monetaryColumns = [
    "input_microusd_per_million",
    "output_microusd_per_million",
    "microusd_per_unit",
    "cost_microusd",
    "invoiced_cost_microusd",
    "ledger_cost_microusd",
    "variance_microusd",
  ];
  for (const column of monetaryColumns) {
    assert.match(cleanInstall, new RegExp(`${column} bigint`));
    assert.match(upgrade, new RegExp(`'${column}'`));
    assert.match(schema, new RegExp(`bigint\\("${column}", \\{ mode: "number" \\}\\)`));
  }
  assert.match(upgrade, /data_type <> 'bigint'/);
  assert.ok(
    runner.indexOf('"0017_provider_usage_ledger.sql", "0018_provider_monetary_bigint.sql"') >= 0,
    "clean installs must run 0017 before the bigint upgrade contract"
  );
  assert.match(runner, /existingCount === 0/);
  assert.match(runner, /fileNames = \["0017_provider_usage_ledger_rollback\.sql"\]/);
});