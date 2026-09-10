import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { eq, inArray } from "drizzle-orm";
import { closeDb, systemDb } from "../lib/db";
import {
  appendProviderAdjustment,
  recordProviderInvoiceReconciliation,
  recordProviderUsage,
} from "../lib/provider-usage-ledger";
import { runWithSystemContext } from "../lib/tenant-context";
import { providerInvoiceReconciliations, providerUsageLedger } from "../shared/schema";

const connectionString = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for provider ledger integration tests");

const sourceEventId = "test:provider-usage-ledger:concurrency:v1";
const bigintOriginalSourceEventId = "test:provider-usage-ledger:bigint-original:v1";
const accountingFixtureTeamPublicIds = [
  "10000000-0000-4000-8000-000000000101",
  "10000000-0000-4000-8000-000000000102",
] as const;
let concurrencyTeamId: number;
let bigintTeamId: number;
let collisionTeamId: number;
let eventId: number;
let isolatedUserId: number;
let isolatedTeamId: number;

before(async () => {
  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    // Immutable ledger events retain their owning workspace forever, so these
    // deterministic, test-only accounting workspaces are intentionally stable
    // fixtures rather than arbitrary customer teams that teardown cannot delete.
    const fixtureUser = await owner.query<{ id: number }>(
      `INSERT INTO users (public_id, email, role, account_status)
       VALUES ('10000000-0000-4000-8000-000000000001',
               'provider-ledger-fixture@example.invalid',
               'team_member',
               'active')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
    );
    const fixtureTeams = await Promise.all(accountingFixtureTeamPublicIds.map((publicId, index) =>
      owner.query<{ id: number }>(
        `INSERT INTO teams (public_id, name, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [publicId, `Provider ledger integration fixture ${index + 1}`, fixtureUser.rows[0]!.id],
      )
    ));
    const primaryFixtureTeamId = fixtureTeams[0]!.rows[0]!.id;
    collisionTeamId = fixtureTeams[1]!.rows[0]!.id;

    const historical = await systemDb
      .select({ sourceEventId: providerUsageLedger.sourceEventId, teamId: providerUsageLedger.teamId })
      .from(providerUsageLedger)
      .where(inArray(providerUsageLedger.sourceEventId, [
        sourceEventId,
        bigintOriginalSourceEventId,
      ]));
    concurrencyTeamId = historical.find((row) => row.sourceEventId === sourceEventId)?.teamId
      ?? primaryFixtureTeamId;
    bigintTeamId = historical.find((row) => row.sourceEventId === bigintOriginalSourceEventId)?.teamId
      ?? primaryFixtureTeamId;

    const fixtureKey = randomUUID();
    const user = await owner.query<{ id: number }>(
      `INSERT INTO users (email, role, account_status)
       VALUES ($1, 'team_member', 'active')
       RETURNING id`,
      [`provider-ledger-rls-${fixtureKey}@example.invalid`],
    );
    isolatedUserId = user.rows[0]!.id;
    const team = await owner.query<{ id: number }>(
      `INSERT INTO teams (name, created_by)
       VALUES ($1, $2)
       RETURNING id`,
      [`Provider ledger RLS fixture ${fixtureKey}`, isolatedUserId],
    );
    isolatedTeamId = team.rows[0]!.id;
    await owner.query(
      `INSERT INTO team_members (team_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [isolatedTeamId, isolatedUserId],
    );
  } finally {
    await owner.end();
  }
});

after(async () => {
  if (isolatedUserId && isolatedTeamId) {
    const owner = new Client({ connectionString });
    await owner.connect();
    try {
      await owner.query("DELETE FROM teams WHERE id = $1", [isolatedTeamId]);
      await owner.query("DELETE FROM users WHERE id = $1", [isolatedUserId]);
    } finally {
      await owner.end();
    }
  }
  await closeDb();
});

test("concurrent duplicate provider events insert exactly once", async () => {
  const results = await runWithSystemContext("provider ledger concurrent idempotency test", () =>
    Promise.all(Array.from({ length: 8 }, () => recordProviderUsage({
      sourceEventId,
      teamId: concurrencyTeamId,
      operationType: "other",
      provider: "brave",
      model: "web-search",
      unitType: "requests",
      unitCount: 0,
      costMicrousd: 0,
      providerMetadata: { testEvent: true },
    })))
  );
  eventId = results[0]!.event.id;
  assert.ok(results.every((result) => result.event.id === eventId));
  assert.ok(results.filter((result) => result.inserted).length <= 1);
});

test("a source event cannot be rebound across tenants", async () => {
  await assert.rejects(
    runWithSystemContext("provider ledger source collision test", () => recordProviderUsage({
      sourceEventId,
      teamId: collisionTeamId,
      operationType: "other",
      provider: "brave",
      model: "web-search",
      unitType: "requests",
      unitCount: 0,
      costMicrousd: 0,
    })),
    /different accounting event/
  );
});

test("database trigger rejects mutation of a recorded event", async () => {
  await assert.rejects(
    runWithSystemContext("provider ledger append-only test", async () =>
      await systemDb.update(providerUsageLedger)
        .set({ costMicrousd: 1 })
        .where(eq(providerUsageLedger.id, eventId))
    ),
    (error: unknown) => {
      const wrapped = error as { message?: string; cause?: { message?: string } };
      return /append-only/.test(`${wrapped.message ?? ""} ${wrapped.cause?.message ?? ""}`);
    }
  );
});

test("bigint correction and invoice variance persist exactly above int4 range", async () => {
  const largeCorrection = 3_000_000_001;
  const periodStart = new Date("2040-01-01T00:00:00.000Z");
  const periodEnd = new Date("2040-02-01T00:00:00.000Z");
  const provider = "test-bigint-provider";
  const invoiceReference = "test:provider-usage-ledger:bigint-invoice:v1";

  await runWithSystemContext("provider ledger bigint accounting test", async () => {
    const original = await recordProviderUsage({
      sourceEventId: "test:provider-usage-ledger:bigint-original:v1",
      teamId: bigintTeamId,
      operationType: "bigint_contract",
      provider,
      model: "unpriced-test-model",
      unitType: "requests",
      unitCount: 0,
      costMicrousd: 0,
      occurredAt: new Date("2040-01-10T00:00:00.000Z"),
    });
    const correction = await appendProviderAdjustment({
      sourceEventId: "test:provider-usage-ledger:bigint-correction:v1",
       teamId: bigintTeamId,
      eventType: "correction",
      originalEventId: original.event.id,
      operationType: "bigint_contract_correction",
      provider,
      model: "unpriced-test-model",
      unitType: "requests",
      costMicrousd: largeCorrection,
      occurredAt: new Date("2040-01-11T00:00:00.000Z"),
    });
    assert.equal(correction.event.costMicrousd, largeCorrection);

    const reconciliation = await recordProviderInvoiceReconciliation({
      provider,
      invoiceReference,
      periodStart,
      periodEnd,
      invoicedCostMicrousd: largeCorrection + 123,
    });
    assert.equal(reconciliation.ledgerCostMicrousd, largeCorrection);
    assert.equal(reconciliation.varianceMicrousd, 123);

    const [persistedCorrection] = await systemDb.select({ cost: providerUsageLedger.costMicrousd })
      .from(providerUsageLedger)
      .where(eq(providerUsageLedger.sourceEventId, "test:provider-usage-ledger:bigint-correction:v1"))
      .limit(1);
    const [persistedInvoice] = await systemDb.select({
      invoiced: providerInvoiceReconciliations.invoicedCostMicrousd,
      ledger: providerInvoiceReconciliations.ledgerCostMicrousd,
      variance: providerInvoiceReconciliations.varianceMicrousd,
    }).from(providerInvoiceReconciliations)
      .where(eq(providerInvoiceReconciliations.invoiceReference, invoiceReference))
      .limit(1);
    assert.equal(persistedCorrection?.cost, largeCorrection);
    assert.deepEqual(persistedInvoice, {
      invoiced: largeCorrection + 123,
      ledger: largeCorrection,
      variance: 123,
    });
  });
});

test("tenant RLS cannot read another workspace's provider cost event", async (t) => {
  if (!isolatedUserId || !isolatedTeamId) return t.skip("isolated tenant fixture unavailable");
  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    await owner.query("BEGIN");
    await owner.query("SET LOCAL ROLE citefi_tenant");
    await owner.query(
      `SELECT set_config('citefi.actor_type','web',true),
              set_config('citefi.user_id',$1,true),
              set_config('citefi.team_id',$2,true),
              set_config('citefi.member_role',$3,true)`,
      [String(isolatedUserId), String(isolatedTeamId), "member"]
    );
    const result = await owner.query(
      "SELECT id FROM provider_usage_ledger WHERE source_event_id = $1",
      [sourceEventId]
    );
    assert.equal(result.rowCount, 0);
    await owner.query("ROLLBACK");
  } finally {
    await owner.query("ROLLBACK").catch(() => undefined);
    await owner.end();
  }
});