import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import { asc, eq, isNull } from "drizzle-orm";
import { closeDb, db } from "../lib/db";
import {
  appendProviderAdjustment,
  recordProviderInvoiceReconciliation,
  recordProviderUsage,
} from "../lib/provider-usage-ledger";
import { runWithSystemContext } from "../lib/tenant-context";
import { providerInvoiceReconciliations, providerUsageLedger, teams } from "../shared/schema";

const connectionString = process.env.DATABASE_URL ?? process.env.NEON_DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for provider ledger integration tests");

const sourceEventId = "test:provider-usage-ledger:concurrency:v1";
let teamIds: number[] = [];
let eventId: number;

before(async () => {
  teamIds = await runWithSystemContext("provider ledger integration fixture", async () => {
    const existing = await db.select({ teamId: providerUsageLedger.teamId })
      .from(providerUsageLedger)
      .where(eq(providerUsageLedger.sourceEventId, sourceEventId))
      .limit(1);
    if (existing[0]) {
      const others = await db.select({ id: teams.id }).from(teams)
        .where(isNull(teams.deletedAt)).orderBy(asc(teams.id)).limit(20);
      return [existing[0].teamId, ...others.map((row) => row.id).filter((id) => id !== existing[0]!.teamId)].slice(0, 2);
    }
    const rows = await db.select({ id: teams.id }).from(teams).orderBy(asc(teams.id)).limit(2);
    return rows.map((row) => row.id);
  });
  if (!teamIds.length) throw new Error("Provider ledger integration test requires an existing team");
});

after(async () => {
  await closeDb();
});

test("concurrent duplicate provider events insert exactly once", async () => {
  const results = await runWithSystemContext("provider ledger concurrent idempotency test", () =>
    Promise.all(Array.from({ length: 8 }, () => recordProviderUsage({
      sourceEventId,
      teamId: teamIds[0],
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

test("a source event cannot be rebound across tenants", async (t) => {
  if (teamIds.length < 2) return t.skip("requires two teams");
  await assert.rejects(
    runWithSystemContext("provider ledger source collision test", () => recordProviderUsage({
      sourceEventId,
      teamId: teamIds[1],
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
      await db.update(providerUsageLedger)
        .set({ costMicrousd: 1 })
        .where(eq(providerUsageLedger.id, eventId))
    ),
    /append-only/
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
      teamId: teamIds[0],
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
      teamId: teamIds[0],
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

    const [persistedCorrection] = await db.select({ cost: providerUsageLedger.costMicrousd })
      .from(providerUsageLedger)
      .where(eq(providerUsageLedger.sourceEventId, "test:provider-usage-ledger:bigint-correction:v1"))
      .limit(1);
    const [persistedInvoice] = await db.select({
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
  const owner = new Client({ connectionString });
  await owner.connect();
  try {
    const memberships = await owner.query<{ userId: number; teamId: number; role: string }>(
      `SELECT tm.user_id AS "userId", tm.team_id AS "teamId", tm.role
         FROM team_members tm
        WHERE tm.team_id <> $1 AND tm.role IN ('owner','admin','member')
        LIMIT 1`,
      [teamIds[0]]
    );
    const membership = memberships.rows[0];
    if (!membership) return t.skip("requires a member on a second team");
    await owner.query("BEGIN");
    await owner.query("SET LOCAL ROLE citefi_tenant");
    await owner.query(
      `SELECT set_config('citefi.actor_type','web',true),
              set_config('citefi.user_id',$1,true),
              set_config('citefi.team_id',$2,true),
              set_config('citefi.member_role',$3,true)`,
      [String(membership.userId), String(membership.teamId), membership.role]
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