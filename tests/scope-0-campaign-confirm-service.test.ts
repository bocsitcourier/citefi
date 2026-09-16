/**
 * Scope 0 direct confirmBrandSnapshot locks. The real service function builds
 * tenant-scoped Drizzle predicates and update payloads; the database module is
 * replaced with a read-only query/update recorder, so no SQL is sent.
 *
 * Run:
 *   NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
 *     --import ./QA/support/offline-guard.mjs \
 *     --experimental-loader ./tests/scope-0-alias-loader.mjs \
 *     --experimental-test-module-mocks --import tsx/esm --test \
 *     tests/scope-0-campaign-confirm-service.test.ts
 */
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";

const moduleMock = (mock as any).module.bind(mock) as (
  specifier: string,
  options: { namedExports?: Record<string, unknown>; defaultExport?: unknown },
) => void;

const campaign = {
  id: 41,
  teamId: 10,
  businessUrl: "https://fixture.example/services",
  brandProfileSnapshot: { source: "frozen-fixture", approved: true },
  brandStatus: "ready",
};
const profile = {
  status: "complete",
  websiteUrl: "https://www.fixture.example/services/",
  profileJson: { source: "current-profile", approved: false },
};
let campaignRows: any[][] = [];
let profileRows: any[][] = [];
const dbCalls = { select: 0, update: 0 };
const updatePayloads: any[] = [];
const dbPredicates: Array<{ operation: string; sql: string; params: unknown[] }> = [];
const pgDialect = new PgDialect();

function query(rows: any[]) {
  const pending: any = Promise.resolve(rows);
  pending.limit = async () => rows;
  return pending;
}

const fakeDb = {
  select: () => {
    dbCalls.select++;
    return {
      from: () => ({
        where: (predicate: unknown) => {
          const compiled = pgDialect.sqlToQuery(predicate as any);
          dbPredicates.push({
            operation: dbCalls.select === 1 ? "campaign-read" : "profile-read",
            sql: compiled.sql,
            params: compiled.params,
          });
          return query(
            dbCalls.select === 1
              ? (campaignRows.shift() ?? [])
              : (profileRows.shift() ?? []),
          );
        },
      }),
    };
  },
  update: () => {
    dbCalls.update++;
    return {
      set: (values: unknown) => {
        updatePayloads.push(values);
        return {
          where: async (predicate: unknown) => {
            const compiled = pgDialect.sqlToQuery(predicate as any);
            dbPredicates.push({
              operation: "campaign-update",
              sql: compiled.sql,
              params: compiled.params,
            });
          },
        };
      },
    };
  },
};

const dbUrl = new URL("../lib/db.ts", import.meta.url).href;
moduleMock(dbUrl, { namedExports: { db: fakeDb } });

function reset() {
  campaignRows = [];
  profileRows = [];
  dbCalls.select = 0;
  dbCalls.update = 0;
  updatePayloads.length = 0;
  dbPredicates.length = 0;
}

beforeEach(reset);

test("real confirmBrandSnapshot freezes the existing snapshot and records confirmation timestamps", async () => {
  const { confirmBrandSnapshot } = await import("../lib/campaign-service.js");
  const frozenBefore = structuredClone(campaign.brandProfileSnapshot);
  campaignRows = [[{ ...campaign }]];
  profileRows = [[{ ...profile }]];

  const result = await confirmBrandSnapshot(10, 41);

  assert.deepEqual(result, { ok: true });
  assert.equal(dbCalls.select, 2);
  assert.equal(dbCalls.update, 1);
  const payload = updatePayloads[0];
  assert.deepEqual(payload.brandProfileSnapshot, frozenBefore);
  assert.equal(payload.brandStatus, "confirmed");
  assert.ok(payload.brandConfirmedAt instanceof Date);
  assert.ok(payload.updatedAt instanceof Date);
  assert.deepEqual(campaign.brandProfileSnapshot, frozenBefore);
  const campaignRead = dbPredicates.find((predicate) => predicate.operation === "campaign-read")!;
  const campaignUpdate = dbPredicates.find((predicate) => predicate.operation === "campaign-update")!;
  for (const predicate of [campaignRead, campaignUpdate]) {
    assert.match(predicate.sql, /"campaigns"\."id" = \$1/);
    assert.match(predicate.sql, /"campaigns"\."team_id" = \$2/);
    assert.match(predicate.sql, /"campaigns"\."deleted_at" is null/);
    assert.deepEqual(predicate.params, [41, 10]);
  }
  const profileRead = dbPredicates.find((predicate) => predicate.operation === "profile-read")!;
  assert.match(profileRead.sql, /"client_brand_profiles"\."team_id" = \$1/);
  assert.deepEqual(profileRead.params, [10]);
});

test("real confirmBrandSnapshot returns research_incomplete without updating an unready campaign", async () => {
  const { confirmBrandSnapshot } = await import("../lib/campaign-service.js");
  campaignRows = [[{ ...campaign, brandProfileSnapshot: null, brandStatus: "planning" }]];
  profileRows = [[{ ...profile }]];

  const result = await confirmBrandSnapshot(10, 41);

  assert.deepEqual(result, { ok: false, reason: "research_incomplete" });
  assert.equal(dbCalls.select, 2);
  assert.equal(dbCalls.update, 0);
  assert.equal(updatePayloads.length, 0);
});

test("real confirmBrandSnapshot returns not_found and does not cross tenant boundaries", async () => {
  const { confirmBrandSnapshot } = await import("../lib/campaign-service.js");
  // This is the DB mock's tenant-filtered result for a team that does not own
  // the campaign. The service must not attempt a profile lookup or update.
  campaignRows = [[]];

  const result = await confirmBrandSnapshot(999, 41);

  assert.deepEqual(result, { ok: false, reason: "not_found" });
  assert.equal(dbCalls.select, 1);
  assert.equal(dbCalls.update, 0);
  assert.equal(updatePayloads.length, 0);
  assert.match(dbPredicates[0]!.sql, /"campaigns"\."id" = \$1/);
  assert.match(dbPredicates[0]!.sql, /"campaigns"\."team_id" = \$2/);
  assert.match(dbPredicates[0]!.sql, /"campaigns"\."deleted_at" is null/);
  assert.deepEqual(dbPredicates[0]!.params, [41, 999]);
});