/**
 * Task #151 — Migration / backfill invariants + legacy export compatibility
 * =========================================================================
 * Verifies the campaigns migration (0015) is structurally correct and idempotent
 * without applying it destructively. It asserts:
 *
 *   (A) Static migration-file invariants: single transaction, fail-closed
 *       preflight, IF NOT EXISTS / guarded DDL, same-team composite FKs, RLS
 *       enable+force, and idempotent backfill guards.
 *   (B) Live schema invariants against the current dev DB: campaigns +
 *       campaign_exports exist with composite (team_id,id) unique target, all 9
 *       content roots carry a nullable campaign_id + same-team composite FK, and
 *       every backfilled child's campaign is same-team (no cross-tenant links).
 *   (C) Legacy batch-export route module still exports a GET handler and its
 *       filename/URL contract (batch-<id>-export.zip) is unchanged, so the new
 *       campaign export does not break the legacy endpoint.
 *
 * No writes are performed; this test is read-only and safe to re-run.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test tests/campaigns/campaign-migration.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { systemDb, closeDb } from "../../lib/db.js";
import { sql } from "drizzle-orm";

after(async () => {
  await closeDb();
});

const ROOT = resolve(import.meta.dirname, "../..");
const MIGRATION = readFileSync(
  resolve(ROOT, "migrations/0015_campaigns.sql"),
  "utf8"
);

const CONTENT_ROOTS = [
  "job_batches",
  "articles",
  "social_posts",
  "video_ideas",
  "publishing_jobs",
  "cost_telemetry",
  "usage_events",
  "content_performance_metrics",
  "content_events",
] as const;

// ── (A) Static migration-file invariants ──────────────────────────────────────

test("migration is a single fully-transactional block", () => {
  assert.match(MIGRATION, /^\s*BEGIN;/m, "must open a transaction");
  assert.match(MIGRATION, /COMMIT;\s*$/m, "must commit the transaction");
  assert.equal(
    (MIGRATION.match(/\bBEGIN;/g) || []).length,
    1,
    "exactly one BEGIN"
  );
  assert.equal(
    (MIGRATION.match(/\bCOMMIT;/g) || []).length,
    1,
    "exactly one COMMIT"
  );
});

test("migration fails closed on missing tenant RLS prerequisites", () => {
  assert.match(MIGRATION, /citefi_tenant/, "checks tenant role");
  assert.match(MIGRATION, /citefi_rls/, "checks helper schema");
  assert.match(
    MIGRATION,
    /tenant_can_access/,
    "checks membership-gate helper presence"
  );
  assert.match(
    MIGRATION,
    /RAISE EXCEPTION[\s\S]*Apply migration 0014/,
    "aborts when prerequisites are missing"
  );
});

test("all new/altered DDL is idempotent-guarded", () => {
  assert.match(
    MIGRATION,
    /CREATE TABLE IF NOT EXISTS "campaigns"/,
    "campaigns table guarded"
  );
  assert.match(
    MIGRATION,
    /CREATE TABLE IF NOT EXISTS "campaign_exports"/,
    "campaign_exports table guarded"
  );
  // Composite (team_id, id) unique target for same-team FKs.
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_team_id_id_unique"/,
    "composite unique target present"
  );
  // Per-team idempotent creation key.
  assert.match(
    MIGRATION,
    /campaigns_team_idempotency_unique/,
    "per-team idempotency unique index present"
  );
  // campaign_id column added conditionally on every root.
  assert.match(
    MIGRATION,
    /ADD COLUMN IF NOT EXISTS "campaign_id"/,
    "campaign_id column add is guarded"
  );
  // FK creation is guarded against re-run name clashes.
  assert.match(
    MIGRATION,
    /pg_constraint WHERE conname = fk_name/,
    "root FK creation guarded by conname existence check"
  );
  assert.match(
    MIGRATION,
    /campaign_exports_campaign_team_fk/,
    "campaign_exports composite FK present"
  );
});

test("migration enables + forces RLS on both new tables", () => {
  for (const tbl of ["campaigns", "campaign_exports"]) {
    assert.match(
      MIGRATION,
      new RegExp(`ALTER TABLE "${tbl}" ENABLE ROW LEVEL SECURITY`),
      `${tbl} RLS enabled`
    );
    assert.match(
      MIGRATION,
      new RegExp(`ALTER TABLE "${tbl}" FORCE ROW LEVEL SECURITY`),
      `${tbl} RLS forced`
    );
  }
});

test("backfill statements are idempotent (NOT EXISTS / IS NULL guarded)", () => {
  // 4a: per team+batch backfill must not duplicate on re-run.
  assert.match(
    MIGRATION,
    /NOT EXISTS\s*\(\s*SELECT 1 FROM "campaigns" c WHERE c.legacy_batch_id = b.id\s*\)/,
    "batch backfill guarded by legacy_batch_id"
  );
  // 4b–4f attach only where campaign_id IS NULL and team matches (never cross-tenant).
  assert.match(MIGRATION, /b\.campaign_id IS NULL/, "batch attach guarded");
  assert.match(MIGRATION, /c\.team_id = b\.team_id/, "same-team batch link");
  assert.match(
    MIGRATION,
    /a\.team_id = b\.team_id/,
    "same-team article link"
  );
  assert.match(
    MIGRATION,
    /r\.team_id IS NOT NULL[\s\S]*r\.campaign_id IS NULL/,
    "generic root attach guarded by team + null campaign"
  );
});

test("legacy campaign JSON matches the workspace contract", () => {
  assert.match(
    MIGRATION,
    /jsonb_build_array\('brand_awareness'::text\) AS goals/,
    "legacy goals are canonical strings"
  );
  assert.match(
    MIGRATION,
    /jsonb_build_object\('label', b\.business_address\)/,
    "legacy locations expose the label field used by the workspace"
  );
  assert.match(
    MIGRATION,
    /UPDATE "campaigns" c[\s\S]*jsonb_typeof\(g\) <> 'string'/,
    "earlier malformed backfills are normalized on migration re-run"
  );
});

// ── (B) Live schema invariants against the current dev DB ─────────────────────

test("campaigns and campaign_exports exist in the live DB", async () => {
  const rows = await systemDb.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE tablename IN ('campaigns','campaign_exports')
    ORDER BY tablename
  `);
  const names = (rows.rows as any[]).map((r) => r.tablename).sort();
  assert.deepEqual(names, ["campaign_exports", "campaigns"]);
});

test("composite (team_id,id) unique index exists on campaigns", async () => {
  const rows = await systemDb.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'campaigns' AND indexname = 'campaigns_team_id_id_unique'
  `);
  assert.equal(
    (rows.rows as any[]).length,
    1,
    "composite unique target must exist for same-team FKs"
  );
});

test("every content root has a nullable campaign_id column", async () => {
  const rows = await systemDb.execute(sql`
    SELECT table_name, is_nullable
    FROM information_schema.columns
    WHERE column_name = 'campaign_id'
      AND table_name = ANY(ARRAY[${sql.join(
        CONTENT_ROOTS.map((r) => sql`${r}`),
        sql`, `
      )}]::text[])
  `);
  const map = new Map(
    (rows.rows as any[]).map((r) => [r.table_name, r.is_nullable])
  );
  for (const root of CONTENT_ROOTS) {
    assert.equal(map.get(root), "YES", `${root}.campaign_id must exist + nullable`);
  }
});

test("every content root has a same-team composite FK to campaigns", async () => {
  const rows = await systemDb.execute(sql`
    SELECT conrelid::regclass::text AS tbl
    FROM pg_constraint
    WHERE conname LIKE '%_campaign_team_fk'
      AND confrelid = 'campaigns'::regclass
  `);
  const tables = new Set((rows.rows as any[]).map((r) => r.tbl));
  for (const root of CONTENT_ROOTS) {
    assert.equal(
      tables.has(root),
      true,
      `${root} must have a same-team composite FK to campaigns`
    );
  }
  assert.equal(
    tables.has("campaign_exports"),
    true,
    "campaign_exports must have a same-team composite FK to campaigns"
  );
});

test("backfill invariant: no child row links to a cross-team campaign", async () => {
  // For each root, count rows whose campaign belongs to a different team.
  for (const root of CONTENT_ROOTS) {
    const rows = await systemDb.execute(sql`
      SELECT COUNT(*)::int AS bad
      FROM ${sql.identifier(root)} r
      JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.campaign_id IS NOT NULL
        AND r.team_id IS NOT NULL
        AND c.team_id <> r.team_id
    `);
    const bad = (rows.rows as any[])[0]?.bad ?? 0;
    assert.equal(bad, 0, `${root} must have no cross-team campaign links`);
  }
});

test("backfill invariant: legacy_batch_id maps at most one campaign per batch", async () => {
  const rows = await systemDb.execute(sql`
    SELECT legacy_batch_id, COUNT(*)::int AS n
    FROM campaigns
    WHERE legacy_batch_id IS NOT NULL
    GROUP BY legacy_batch_id
    HAVING COUNT(*) > 1
  `);
  assert.equal(
    (rows.rows as any[]).length,
    0,
    "each legacy batch must map to at most one campaign (idempotent backfill)"
  );
});

test("live legacy campaigns use render-safe goals and locations", async () => {
  const rows = await systemDb.execute(sql`
    SELECT count(*)::int AS invalid_count
    FROM campaigns c
    WHERE c.legacy_batch_id IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(c.goals, '[]'::jsonb)) g
          WHERE jsonb_typeof(g) <> 'string'
        )
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(c.locations, '[]'::jsonb)) l
          WHERE jsonb_typeof(l) <> 'object' OR NOT (l ? 'label')
        )
      )
  `);
  assert.equal((rows.rows[0] as any).invalid_count, 0);
});

// ── (C) Legacy batch-export URL/API compatibility ─────────────────────────────

test("legacy batch export route still exports a GET handler", async () => {
  const mod = await import("../../app/api/export/batch/[id]/route.js");
  assert.equal(
    typeof (mod as any).GET,
    "function",
    "legacy GET export handler must remain exported"
  );
});

test("legacy batch export filename/content-type contract is unchanged", () => {
  const src = readFileSync(
    resolve(ROOT, "app/api/export/batch/[id]/route.ts"),
    "utf8"
  );
  assert.match(
    src,
    /"Content-Type": 'application\/zip'|'Content-Type': 'application\/zip'/,
    "legacy export must still return application/zip"
  );
  assert.match(
    src,
    /batch-\$\{batchId\}-export\.zip/,
    "legacy export filename contract (batch-<id>-export.zip) must be unchanged"
  );
  // Team isolation guard must remain in the legacy route.
  assert.match(
    src,
    /eq\(jobBatches\.teamId, teamId\)/,
    "legacy export must remain team-scoped"
  );
});

test("successful generation records canonical campaign usage attribution", () => {
  const articleWorker = readFileSync(resolve(ROOT, "lib/worker.ts"), "utf8");
  const socialWorker = readFileSync(resolve(ROOT, "lib/social-worker.ts"), "utf8");
  const submitRoute = readFileSync(
    resolve(ROOT, "app/api/jobs/batch-submit/route.ts"),
    "utf8"
  );
  assert.match(articleWorker, /recordUsageEvent\(\{[\s\S]*?campaignId:\s*job\.data\.campaignId/);
  assert.match(socialWorker, /recordUsageEvent\(\{[\s\S]*?campaignId:\s*postDetails\?\.campaignId/);
  assert.match(submitRoute, /checkUsageCap\([\s\S]*?batch\.campaignId/);
});

test("every campaign-derived deliverable threads canonical campaign context", () => {
  const contracts = [
    ["lib/worker.ts", /campaignId:\s*(?:currentArticle|batch)\.campaignId/],
    ["lib/social-worker.ts", /campaignId:\s*postDetails\.campaignId/],
    ["lib/social-video-generator.ts", /campaignId:\s*post\.campaignId/],
    ["lib/veo-idea-orchestrator.ts", /campaignId:\s*videoCampaignId/],
    ["lib/podcast-worker.ts", /campaignId:\s*article\.campaignId/],
    [
      "app/api/batches/[id]/regenerate-images/route.ts",
      /campaignId:\s*batch\.campaignId/,
    ],
    [
      "app/api/social-posts/variants/[variantId]/regenerate/route.ts",
      /campaignId:\s*post\.campaignId/,
    ],
  ] as const;

  for (const [relativePath, contract] of contracts) {
    const source = readFileSync(resolve(ROOT, relativePath), "utf8");
    assert.match(source, contract, relativePath);
  }
});
