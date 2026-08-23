-- ============================================================================
-- Migration 0015 — Campaigns aggregate (Task #151)
-- ============================================================================
-- Introduces the team-scoped `campaigns` aggregate and its `campaign_exports`
-- child, adds a nullable `campaign_id` to every independently-queried content
-- root, wires same-team composite foreign keys, indexes, RLS (ENABLE + FORCE
-- with SELECT/INSERT/UPDATE/DELETE policies, grants, sequence usage) for the two
-- new tables using the existing `citefi_rls` helper schema from migration 0014,
-- and idempotently backfills campaigns from existing team+batch history.
--
-- FULLY TRANSACTIONAL + IDEMPOTENT: the whole file runs in one BEGIN/COMMIT and
-- is safe to re-run. Every DDL statement uses IF EXISTS / IF NOT EXISTS /
-- CREATE OR REPLACE / DO-guards; every backfill statement is guarded so it never
-- duplicates rows or re-links already-linked children.
--
-- ORDER OF OPERATIONS (dependency-safe):
--   1. Create campaigns + campaign_exports tables and their indexes/uniques.
--   2. Add campaign_id columns + same-team composite FKs + indexes on the 9 roots.
--   3. RLS: ENABLE + FORCE, policies, grants, sequence usage for the 2 new tables.
--   4. Backfill: one campaign per team+batch (legacy_batch_id) + one "Imported
--      legacy work" campaign per team for the remaining standalone roots.
--
-- REQUIRES migration 0014 (citefi_rls schema + citefi_tenant role) to be applied
-- first. This migration FAILS CLOSED: a preflight check (step 0, below) aborts
-- the whole transaction BEFORE any DDL or backfill runs if the citefi_tenant
-- role, the citefi_rls helper schema, or the membership-gate helper
-- (citefi_rls.tenant_can_access) is missing — so campaigns / campaign_exports can
-- never be created without their tenant-isolation policies in place.
-- See scripts/apply-tenant-rls.ts / scripts/migrate-t151-campaigns.ts and
-- scripts/post-merge.sh / scripts/deploy-to-do.sh for ordering. Rollback:
-- migrations/0015_campaigns_rollback.sql (code MUST be rolled back before the
-- schema — see that file's header).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Preflight — FAIL CLOSED before any DDL/backfill.
--    Tenant isolation for the new tables depends entirely on migration 0014's
--    role + helper schema + membership gate. If any of them is missing we abort
--    the entire transaction (nothing is created) rather than committing tables
--    that FORCE RLS but have no working policies/helpers behind them.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant') THEN
    RAISE EXCEPTION
      'Campaigns migration aborted: role citefi_tenant is missing. Apply migration 0014 (tenant RLS) first.'
      USING ERRCODE = '42704';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'citefi_rls') THEN
    RAISE EXCEPTION
      'Campaigns migration aborted: schema citefi_rls is missing. Apply migration 0014 (tenant RLS) first.'
      USING ERRCODE = '3F000';
  END IF;

  -- The single membership gate every tenant-direct policy calls. Its presence
  -- (with the expected integer signature) proves the 0014 helpers are installed.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'citefi_rls'
      AND p.proname = 'tenant_can_access'
  ) THEN
    RAISE EXCEPTION
      'Campaigns migration aborted: helper citefi_rls.tenant_can_access() is missing. Apply migration 0014 (tenant RLS) first.'
      USING ERRCODE = '42883';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. campaigns — team-scoped aggregate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "campaigns" (
  "id"                     serial PRIMARY KEY,
  "public_id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id"                integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "created_by"             integer NOT NULL REFERENCES "users"("id"),
  "name"                   varchar(255) NOT NULL,
  "business_url"           text,
  "company_name"           varchar(255),
  "status"                 varchar(30) NOT NULL DEFAULT 'draft',
  "brand_status"           varchar(30),
  "brand_profile_snapshot" jsonb,
  "brand_confirmed_at"     timestamp,
  "goals"                  jsonb,
  "locations"              jsonb,
  "recommended_asset_bundle" jsonb,
  "asset_bundle"           jsonb,
  "credit_estimate"        jsonb,
  "idempotency_key"        varchar(255),
  "compatibility_mode"     varchar(20) NOT NULL DEFAULT 'dual_write',
  "compatibility_ends_at"  timestamp NOT NULL DEFAULT (now() + interval '90 days'),
  "legacy_batch_id"        integer REFERENCES "job_batches"("id"),
  "deleted_at"             timestamp,
  "created_at"             timestamp NOT NULL DEFAULT now(),
  "updated_at"             timestamp NOT NULL DEFAULT now()
);

-- Unique public id (declared as an index so re-runs never clash on constraint name).
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_public_id_key" ON "campaigns" ("public_id");
CREATE INDEX IF NOT EXISTS "campaigns_public_id_idx" ON "campaigns" ("public_id");
CREATE INDEX IF NOT EXISTS "campaigns_team_id_status_idx" ON "campaigns" ("team_id", "status");
CREATE INDEX IF NOT EXISTS "campaigns_created_by_idx" ON "campaigns" ("created_by");
-- Composite (team_id, id) unique target for same-team composite foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_team_id_id_unique" ON "campaigns" ("team_id", "id");
-- Per-team idempotent creation.
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_team_idempotency_unique" ON "campaigns" ("team_id", "idempotency_key");
-- A given legacy batch maps to at most one campaign.
CREATE UNIQUE INDEX IF NOT EXISTS "campaigns_legacy_batch_id_unique" ON "campaigns" ("legacy_batch_id");

-- ---------------------------------------------------------------------------
-- 1b. campaign_exports — per-campaign export requests
-- ---------------------------------------------------------------------------
-- campaign_exports ownership is enforced by a SAME-TEAM COMPOSITE FK
-- (team_id, campaign_id) -> campaigns(team_id, id) ON DELETE CASCADE (added
-- below), which both cascades on campaign deletion AND guarantees an export can
-- never point at a campaign owned by another team. A single-column campaign FK
-- would allow that cross-tenant mismatch, so it is intentionally omitted.
CREATE TABLE IF NOT EXISTS "campaign_exports" (
  "id"           serial PRIMARY KEY,
  "public_id"    uuid NOT NULL DEFAULT gen_random_uuid(),
  "team_id"      integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "campaign_id"  integer NOT NULL,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "request_key"  varchar(255) NOT NULL,
  "kind"         varchar(50) NOT NULL,
  "status"       varchar(30) NOT NULL DEFAULT 'pending',
  "filters"      jsonb,
  "object_url"   text,
  "error"        text,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

-- Same-team composite FK: enforces cross-tenant safety at the DB level and
-- cascades when the owning campaign is deleted. Guarded so re-runs don't clash.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_exports_campaign_team_fk') THEN
    ALTER TABLE "campaign_exports"
      ADD CONSTRAINT "campaign_exports_campaign_team_fk"
      FOREIGN KEY ("team_id", "campaign_id")
      REFERENCES "campaigns" ("team_id", "id")
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_exports_public_id_key" ON "campaign_exports" ("public_id");
CREATE INDEX IF NOT EXISTS "campaign_exports_public_id_idx" ON "campaign_exports" ("public_id");
CREATE INDEX IF NOT EXISTS "campaign_exports_campaign_id_idx" ON "campaign_exports" ("campaign_id");
CREATE INDEX IF NOT EXISTS "campaign_exports_team_id_status_idx" ON "campaign_exports" ("team_id", "status");
CREATE INDEX IF NOT EXISTS "campaign_exports_requested_by_idx" ON "campaign_exports" ("requested_by");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_exports_team_request_key_unique" ON "campaign_exports" ("team_id", "request_key");

-- ---------------------------------------------------------------------------
-- 2. campaign_id on the 9 independently-queried roots + same-team FKs + indexes.
--    Every table here carries a team_id, so we pin ownership with a MATCH SIMPLE
--    composite FK (team_id, campaign_id) -> campaigns(team_id, id). MATCH SIMPLE
--    means the FK only fires when BOTH columns are non-null: genuinely unscoped
--    legacy rows (campaign_id IS NULL) are never blocked.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  fk_name text;
  idx_name text;
  root_tables text[] := ARRAY[
    'job_batches', 'articles', 'social_posts', 'video_ideas', 'publishing_jobs',
    'cost_telemetry', 'usage_events', 'content_performance_metrics', 'content_events'
  ];
BEGIN
  FOREACH t IN ARRAY root_tables LOOP
    -- 2a. Add the nullable column.
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS "campaign_id" integer',
      t
    );

    -- 2b. Same-team composite FK (only when the table exposes team_id).
    fk_name := t || '_campaign_team_fk';
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'team_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I '
        || 'FOREIGN KEY ("team_id", "campaign_id") '
        || 'REFERENCES "campaigns" ("team_id", "id") MATCH SIMPLE',
        t, fk_name
      );
    END IF;

    -- 2c. Lookup index on campaign_id.
    idx_name := t || '_campaign_id_idx';
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I ("campaign_id")',
      idx_name, t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. RLS for the two new tables — mirrors migration 0014's tenant-direct shape.
--    Both tables are tenant-direct (team_id), reusing citefi_rls.tenant_can_access.
-- ---------------------------------------------------------------------------

-- Grants: RLS is the gate, but the tenant role still needs table + sequence DML.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "campaigns" TO citefi_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "campaign_exports" TO citefi_tenant';
    -- Serial PKs on the new tables call nextval() as the tenant role.
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO citefi_tenant';
  ELSE
    RAISE NOTICE 'citefi_tenant role missing — skipping campaign grants (apply migration 0014 first).';
  END IF;
END
$$;

-- campaigns (tenant-direct)
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_campaigns_sel ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_ins ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_upd ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_del ON "campaigns";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'citefi_rls') THEN
    EXECUTE $p$
      CREATE POLICY rls_campaigns_sel ON "campaigns" FOR SELECT TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaigns_ins ON "campaigns" FOR INSERT TO citefi_tenant
        WITH CHECK (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaigns_upd ON "campaigns" FOR UPDATE TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
        WITH CHECK (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaigns_del ON "campaigns" FOR DELETE TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
    $p$;
  ELSE
    RAISE NOTICE 'citefi_rls helpers missing — campaigns RLS policies skipped (apply migration 0014 first).';
  END IF;
END
$$;

-- campaign_exports (tenant-direct)
ALTER TABLE "campaign_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campaign_exports" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_campaign_exports_sel ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_ins ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_upd ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_del ON "campaign_exports";
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'citefi_rls') THEN
    EXECUTE $p$
      CREATE POLICY rls_campaign_exports_sel ON "campaign_exports" FOR SELECT TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaign_exports_ins ON "campaign_exports" FOR INSERT TO citefi_tenant
        WITH CHECK (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaign_exports_upd ON "campaign_exports" FOR UPDATE TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
        WITH CHECK (citefi_rls.tenant_can_access(team_id))
    $p$;
    EXECUTE $p$
      CREATE POLICY rls_campaign_exports_del ON "campaign_exports" FOR DELETE TO citefi_tenant
        USING (citefi_rls.tenant_can_access(team_id))
    $p$;
  ELSE
    RAISE NOTICE 'citefi_rls helpers missing — campaign_exports RLS policies skipped (apply migration 0014 first).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill — idempotent reconstruction of campaigns from history.
--    Runs on the login/owner role (BYPASSRLS), so FORCE RLS on campaigns does
--    not block these system inserts.
-- ---------------------------------------------------------------------------

-- 4a. One campaign per existing team+batch. A batch must have a team_id to be
--     ownable; teamless legacy batches stay unscoped (campaign_id left NULL).
--     legacy_batch_id (unique) makes this insert idempotent across re-runs.
INSERT INTO "campaigns" (
  team_id, created_by, name, business_url, company_name, status,
  brand_status, brand_profile_snapshot, goals, locations,
  idempotency_key, legacy_batch_id, created_at, updated_at
)
SELECT
  b.team_id,
  b.user_id,
  -- core_topic is TEXT in legacy batches; campaign.name is a bounded display
  -- label. Keep the full topic in the JSON snapshot and truncate only the label.
  LEFT(COALESCE(NULLIF(b.core_topic, ''), 'Imported campaign'), 255) AS name,
  b.target_url AS business_url,
  b.business_name AS company_name,
  'active' AS status,
  CASE WHEN b.business_name IS NOT NULL THEN 'confirmed' ELSE NULL END AS brand_status,
  -- Minimal profile snapshot reconstructed from the batch's NAP + topic data.
  jsonb_strip_nulls(jsonb_build_object(
    'source', 'legacy_batch_backfill',
    'topic', b.core_topic,
    'targetUrl', b.target_url,
    'businessName', b.business_name,
    'businessAddress', b.business_address,
    'businessPhone', b.business_phone
  )) AS brand_profile_snapshot,
  -- Legacy batches predate canonical campaign goals. Use a stable canonical
  -- value and preserve the original topic in metadata_json above.
  jsonb_build_array('brand_awareness'::text) AS goals,
  CASE
    WHEN b.business_address IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('label', b.business_address))
    ELSE NULL
  END AS locations,
  'legacy-batch-' || b.id::text AS idempotency_key,
  b.id AS legacy_batch_id,
  b.created_at,
  now()
FROM "job_batches" b
WHERE b.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "campaigns" c WHERE c.legacy_batch_id = b.id
  );

-- Normalize rows created by earlier idempotent runs of this migration so the
-- stored JSON always matches the public API/workspace contract.
UPDATE "campaigns" c
SET
  goals = jsonb_build_array('brand_awareness'::text),
  locations = CASE
    WHEN b.business_address IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('label', b.business_address))
    ELSE NULL
  END,
  updated_at = now()
FROM "job_batches" b
WHERE c.legacy_batch_id = b.id
  AND c.team_id = b.team_id
  AND (
    jsonb_typeof(c.goals) <> 'array'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(c.goals, '[]'::jsonb)) g
      WHERE jsonb_typeof(g) <> 'string'
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(c.locations, '[]'::jsonb)) l
      WHERE jsonb_typeof(l) <> 'object' OR NOT (l ? 'label')
    )
  );

-- 4b. Attach each backfilled batch to its campaign (only when still unset and
--     the campaign's team matches the batch's team — never cross-tenant).
UPDATE "job_batches" b
SET campaign_id = c.id
FROM "campaigns" c
WHERE c.legacy_batch_id = b.id
  AND c.team_id = b.team_id
  AND b.campaign_id IS NULL;

-- 4c. Attach articles to the campaign that owns their batch (same team only).
UPDATE "articles" a
SET campaign_id = b.campaign_id
FROM "job_batches" b
WHERE a.batch_id = b.id
  AND b.campaign_id IS NOT NULL
  AND a.team_id = b.team_id
  AND a.campaign_id IS NULL;

-- 4d. Attach article-linked social posts to that article's campaign (same team).
UPDATE "social_posts" sp
SET campaign_id = a.campaign_id
FROM "articles" a
WHERE sp.article_id = a.id
  AND a.campaign_id IS NOT NULL
  AND sp.team_id = a.team_id
  AND sp.campaign_id IS NULL;

-- 4e. One "Imported legacy work" campaign per team for the remaining standalone
--     roots (rows with a team but no canonical campaign path). Idempotent via a
--     per-team idempotency_key; only created for teams that actually have such
--     orphan rows across the standalone roots.
INSERT INTO "campaigns" (
  team_id, created_by, name, status, idempotency_key, created_at, updated_at
)
SELECT
  t.id AS team_id,
  t.created_by,
  'Imported legacy work' AS name,
  'archived' AS status,
  'legacy-import-team-' || t.id::text AS idempotency_key,
  now(),
  now()
FROM "teams" t
WHERE NOT EXISTS (
    SELECT 1 FROM "campaigns" c
    WHERE c.team_id = t.id
      AND c.idempotency_key = 'legacy-import-team-' || t.id::text
  )
  AND (
    EXISTS (SELECT 1 FROM "social_posts"  s WHERE s.team_id = t.id AND s.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "video_ideas" v WHERE v.team_id = t.id AND v.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "publishing_jobs" p WHERE p.team_id = t.id AND p.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "content_performance_metrics" m WHERE m.team_id = t.id AND m.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "content_events" e WHERE e.team_id = t.id AND e.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "usage_events" u WHERE u.team_id = t.id AND u.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "cost_telemetry" ct WHERE ct.team_id = t.id AND ct.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "job_batches" jb WHERE jb.team_id = t.id AND jb.campaign_id IS NULL)
    OR EXISTS (SELECT 1 FROM "articles" ar WHERE ar.team_id = t.id AND ar.campaign_id IS NULL)
  );

-- 4f. Assign remaining team-scoped standalone rows to their team's legacy import
--     campaign. Each root is updated only where campaign_id is still NULL AND the
--     row's team_id matches the import campaign's team (never cross-tenant). Rows
--     with a NULL team_id (genuinely unscoped) are left untouched.
DO $$
DECLARE
  t text;
  root_tables text[] := ARRAY[
    'job_batches', 'articles', 'social_posts', 'video_ideas', 'publishing_jobs',
    'cost_telemetry', 'usage_events', 'content_performance_metrics', 'content_events'
  ];
BEGIN
  FOREACH t IN ARRAY root_tables LOOP
    EXECUTE format($q$
      UPDATE %I r
      SET campaign_id = c.id
      FROM "campaigns" c
      WHERE c.idempotency_key = 'legacy-import-team-' || r.team_id::text
        AND c.team_id = r.team_id
        AND r.team_id IS NOT NULL
        AND r.campaign_id IS NULL
    $q$, t);
  END LOOP;
END
$$;

COMMIT;

-- ============================================================================
-- End of migration 0015_campaigns.sql
-- ============================================================================
