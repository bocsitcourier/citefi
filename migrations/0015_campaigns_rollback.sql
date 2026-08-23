-- ============================================================================
-- Rollback for migration 0015 — Campaigns aggregate (Task #151)
-- ============================================================================
-- ⚠️  ROLL BACK APPLICATION CODE FIRST  ⚠️
-- This teardown DROPS the campaigns / campaign_exports tables and the
-- campaign_id columns (with their composite foreign keys and indexes) from every
-- content root. Any deployed code that still reads or writes campaigns,
-- campaign_exports, or *.campaign_id (lib/campaign-service.ts, the /api/campaigns
-- routes, the campaign UI, and every generator/telemetry writer that sets
-- campaign_id) will start throwing "column/relation does not exist" the instant
-- this runs. Deploy the campaign-free code revision BEFORE executing this file.
--
-- Reverses migrations/0015_campaigns.sql in strict reverse-dependency order:
--   1. DROP the campaigns/campaign_exports RLS policies (depend on the tables).
--   2. DISABLE + NO FORCE RLS and REVOKE grants on the two new tables.
--   3. DROP each root's same-team composite FK, campaign_id index, and column.
--   4. DROP campaign_exports (child), then campaigns (parent).
--
-- The backfilled campaign rows are destroyed with the tables (step 4); the
-- campaign_id links are destroyed with the columns (step 3). This is a
-- structural teardown, not a data-preserving down-migration.
--
-- FULLY IDEMPOTENT: every statement uses IF EXISTS / DO-guards, safe to re-run.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Drop RLS policies on the new tables.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rls_campaign_exports_sel ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_ins ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_upd ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaign_exports_del ON "campaign_exports";
DROP POLICY IF EXISTS rls_campaigns_sel ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_ins ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_upd ON "campaigns";
DROP POLICY IF EXISTS rls_campaigns_del ON "campaigns";

-- ---------------------------------------------------------------------------
-- 2. Disable + NO FORCE RLS and revoke grants (before dropping the tables).
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS "campaign_exports" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "campaign_exports" DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "campaigns" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "campaigns" DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant') THEN
    IF to_regclass('"campaign_exports"') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON "campaign_exports" FROM citefi_tenant';
    END IF;
    IF to_regclass('"campaigns"') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON "campaigns" FROM citefi_tenant';
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Drop each root's composite FK, campaign_id index, and campaign_id column.
--    (Composite FKs reference campaigns(team_id, id), so they must be dropped
--     before campaigns is dropped in step 4.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  root_tables text[] := ARRAY[
    'job_batches', 'articles', 'social_posts', 'video_ideas', 'publishing_jobs',
    'cost_telemetry', 'usage_events', 'content_performance_metrics', 'content_events'
  ];
BEGIN
  FOREACH t IN ARRAY root_tables LOOP
    IF to_regclass(format('%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_campaign_team_fk');
      EXECUTE format('DROP INDEX IF EXISTS %I', t || '_campaign_id_idx');
      EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS "campaign_id"', t);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Drop the tables (child first, then parent). Indexes/uniques drop with them.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS "campaign_exports";
DROP TABLE IF EXISTS "campaigns";

COMMIT;

-- ============================================================================
-- End of rollback 0015_campaigns_rollback.sql
-- ============================================================================
