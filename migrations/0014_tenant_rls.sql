-- ============================================================================
-- Migration 0014 — Tenant Row-Level Security (Task #150)
-- ============================================================================
-- Creates the NOLOGIN 'citefi_tenant' role, the 'citefi_rls' helper schema with
-- SECURITY DEFINER validation helpers (row_security = off to avoid recursive
-- RLS), grants, and ENABLE + FORCE RLS with SELECT/INSERT/UPDATE/DELETE policies
-- for every tenant-scoped table.
--
-- Runtime contract (lib/db.ts): scoped pooled queries run
--     SET LOCAL ROLE citefi_tenant;
--     set_config('citefi.actor_type'|'citefi.user_id'|'citefi.team_id'|'citefi.member_role', ..., true);
-- System / migration code stays on the BYPASSRLS login role. The apply script
-- refuses to install this migration unless the login role is superuser or has
-- BYPASSRLS; ordinary request/worker queries always SET ROLE citefi_tenant.
--
-- FULLY IDEMPOTENT: safe to run repeatedly. Uses IF EXISTS / IF NOT EXISTS /
-- CREATE OR REPLACE / DO-guards throughout. See migrations/0014_tenant_rls_rollback.sql
-- for the reverse-order teardown.
--
-- Classification reference: reports/tenant-isolation-inventory.md
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Role: citefi_tenant (NOLOGIN — reached only via SET LOCAL ROLE)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant') THEN
    CREATE ROLE citefi_tenant NOLOGIN;
  END IF;
END
$$;

-- Allow the current (owner/login) role to SET ROLE citefi_tenant.
DO $$
BEGIN
  EXECUTE format('GRANT citefi_tenant TO %I', current_user);
  IF NOT pg_has_role(current_user, 'citefi_tenant', 'MEMBER') THEN
    RAISE EXCEPTION
      'Tenant RLS rollout cannot continue: role % is not a member of citefi_tenant',
      current_user;
  END IF;
END
$$;

-- Exercise the exact runtime capability inside the migration transaction. A
-- failed SET ROLE aborts the transaction before FORCE RLS can be committed.
SET LOCAL ROLE citefi_tenant;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 2. Helper schema + SECURITY DEFINER validation helpers (row_security = off)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS citefi_rls;
GRANT USAGE ON SCHEMA citefi_rls TO citefi_tenant;

-- GUC accessors ------------------------------------------------------------
CREATE OR REPLACE FUNCTION citefi_rls.current_team_id()
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('citefi.team_id', true), ''), '0')::integer;
$$;

CREATE OR REPLACE FUNCTION citefi_rls.current_user_id()
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('citefi.user_id', true), '')::integer;
$$;

CREATE OR REPLACE FUNCTION citefi_rls.actor_type()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('citefi.actor_type', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION citefi_rls.member_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('citefi.member_role', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION citefi_rls.is_client_viewer()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT citefi_rls.member_role() = 'client_viewer';
$$;

CREATE OR REPLACE FUNCTION citefi_rls.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT citefi_rls.member_role() = 'platform_admin';
$$;

-- Web membership validation (mirrors requireTeamMember in lib/api/auth.ts):
-- direct admin/member of team, OR admin of the team's parent agency, with the
-- team (and parent) not soft-deleted and client_status = 'active'.
-- SECURITY DEFINER + row_security = off so reading team_members/teams here does
-- NOT recurse into their own RLS policies.
CREATE OR REPLACE FUNCTION citefi_rls.web_membership_valid(target_team integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
DECLARE
  uid integer := citefi_rls.current_user_id();
  parent integer;
BEGIN
  IF citefi_rls.actor_type() <> 'web' OR uid IS NULL OR target_team IS NULL THEN
    RETURN false;
  END IF;

  -- Direct membership on an active, non-deleted team.
  IF EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = uid
      AND tm.team_id = target_team
      AND tm.role IN ('owner', 'admin', 'member')
      AND t.deleted_at IS NULL
      AND t.client_status = 'active'
  ) THEN
    RETURN true;
  END IF;

  -- Agency-admin inheritance: user is an admin of the target team's parent agency.
  SELECT t.parent_team_id INTO parent
  FROM teams t
  WHERE t.id = target_team
    AND t.deleted_at IS NULL
    AND t.client_status = 'active';

  IF parent IS NOT NULL AND EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams pt ON pt.id = tm.team_id
    WHERE tm.user_id = uid
      AND tm.team_id = parent
      AND tm.role IN ('owner', 'admin')
      AND pt.deleted_at IS NULL
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$fn$;

-- Client-reviewer validation is deliberately separate from general membership:
-- the reviewer role can only act for its directly assigned active team and
-- never receives agency inheritance or ordinary member privileges.
CREATE OR REPLACE FUNCTION citefi_rls.client_viewer_membership_valid(target_team integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
DECLARE
  uid integer := citefi_rls.current_user_id();
BEGIN
  IF citefi_rls.actor_type() <> 'web'
     OR citefi_rls.member_role() <> 'client_viewer'
     OR uid IS NULL
     OR target_team IS NULL
     OR target_team <> citefi_rls.current_team_id() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = uid
      AND tm.team_id = target_team
      AND tm.role = 'client_viewer'
      AND t.deleted_at IS NULL
      AND t.client_status = 'active'
  );
END;
$fn$;

-- Worker actor: no user; granted the whole team when it is active & not deleted.
CREATE OR REPLACE FUNCTION citefi_rls.worker_team_active(target_team integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF citefi_rls.actor_type() <> 'worker' OR target_team IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM teams t
    WHERE t.id = target_team
      AND t.deleted_at IS NULL
      AND t.client_status = 'active'
  );
END;
$fn$;

-- The single gate every direct-tenant policy calls. Re-validates membership
-- from the DB and requires the row's team to match the GUC team.
CREATE OR REPLACE FUNCTION citefi_rls.tenant_can_access(row_team integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF row_team IS NULL OR row_team <> citefi_rls.current_team_id() THEN
    RETURN false;
  END IF;
  RETURN citefi_rls.web_membership_valid(row_team)
      OR citefi_rls.worker_team_active(row_team);
END;
$fn$;

-- Whether a given user shares the current team (used by the users self/team read policy).
CREATE OR REPLACE FUNCTION citefi_rls.user_shares_current_team(target_user integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
DECLARE
  team integer := citefi_rls.current_team_id();
BEGIN
  IF team = 0 OR target_user IS NULL THEN
    RETURN false;
  END IF;
  -- Only expose fellow members when the current actor is a validated member of that team.
  IF NOT (citefi_rls.web_membership_valid(team) OR citefi_rls.worker_team_active(team)) THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = target_user AND tm.team_id = team
  );
END;
$fn$;

-- Resolve team hierarchy visibility without recursively invoking the teams RLS
-- policy. Direct SQL subqueries on teams inside that policy recurse at rewrite
-- time; this SECURITY DEFINER helper bypasses RLS for the lookup.
CREATE OR REPLACE FUNCTION citefi_rls.team_in_context_hierarchy(row_team integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
DECLARE
  selected_team integer := citefi_rls.current_team_id();
  selected_parent integer;
  row_parent integer;
BEGIN
  IF row_team IS NULL OR selected_team = 0 THEN
    RETURN false;
  END IF;

  IF citefi_rls.worker_team_active(selected_team) THEN
    RETURN row_team = selected_team;
  END IF;
  IF NOT citefi_rls.web_membership_valid(selected_team) THEN
    RETURN false;
  END IF;
  IF row_team = selected_team THEN
    RETURN true;
  END IF;

  SELECT parent_team_id INTO selected_parent FROM teams WHERE id = selected_team;
  IF row_team = selected_parent THEN
    RETURN true;
  END IF;
  SELECT parent_team_id INTO row_parent FROM teams WHERE id = row_team;
  RETURN row_parent = selected_team;
END;
$fn$;

-- RLS limits which article rows a client reviewer can update, but PostgreSQL
-- row policies cannot limit columns. This trigger provides the complementary
-- column boundary: reviewers may only submit an approval decision, feedback,
-- reviewer identity, review timestamp, and the row's normal updated timestamp.
CREATE OR REPLACE FUNCTION citefi_rls.guard_client_viewer_article_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF citefi_rls.is_client_viewer() THEN
    IF NOT citefi_rls.client_viewer_membership_valid(OLD.approval_team_id) THEN
      RAISE EXCEPTION 'client reviewer membership is no longer authorized'
        USING ERRCODE = '42501';
    END IF;

    IF (
      to_jsonb(NEW) - ARRAY[
        'approval_status',
        'approval_reviewed_at',
        'approval_reviewed_by',
        'approval_feedback',
        'updated_at'
      ]::text[]
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY[
        'approval_status',
        'approval_reviewed_at',
        'approval_reviewed_by',
        'approval_feedback',
        'updated_at'
      ]::text[]
    ) THEN
      RAISE EXCEPTION 'client reviewers may only update approval fields'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.approval_status IS NULL
       OR NEW.approval_status NOT IN ('approved', 'changes_requested') THEN
      RAISE EXCEPTION 'client reviewers may only approve or request changes'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.approval_reviewed_by IS DISTINCT FROM citefi_rls.current_user_id() THEN
      RAISE EXCEPTION 'approval reviewer identity must match the authenticated user'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_client_viewer_article_update ON articles;
CREATE TRIGGER guard_client_viewer_article_update
  BEFORE UPDATE ON articles
  FOR EACH ROW
  EXECUTE FUNCTION citefi_rls.guard_client_viewer_article_update();

-- Lock down helper execution to the tenant role (and owner).
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA citefi_rls FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA citefi_rls TO citefi_tenant;


-- ---------------------------------------------------------------------------
-- 2b. Indirect (parent-resolving) SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION citefi_rls.job_events_parent_access(batch_id integer, article_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF batch_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "job_batches" p
      WHERE p.id = batch_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  IF article_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "articles" p
      WHERE p.id = article_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.article_runs_parent_access(article_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF article_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "articles" p
      WHERE p.id = article_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.batch_seo_cache_parent_access(batch_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF batch_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "job_batches" p
      WHERE p.id = batch_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.seo_logs_parent_access(article_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF article_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "articles" p
      WHERE p.id = article_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.social_post_variants_parent_access(social_post_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF social_post_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "social_posts" p
      WHERE p.id = social_post_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.social_post_assets_parent_access(social_post_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF social_post_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "social_posts" p
      WHERE p.id = social_post_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.social_post_jobs_parent_access(social_post_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF social_post_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "social_posts" p
      WHERE p.id = social_post_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.social_post_logs_parent_access(social_post_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF social_post_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "social_posts" p
      WHERE p.id = social_post_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.error_logs_parent_access(batch_id integer, article_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF batch_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "job_batches" p
      WHERE p.id = batch_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  IF article_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "articles" p
      WHERE p.id = article_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.article_versions_parent_access(article_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF article_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "articles" p
      WHERE p.id = article_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.coverage_nodes_parent_access(cluster_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF cluster_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "content_clusters" p
      WHERE p.id = cluster_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.agent_optimization_logs_parent_access(agent_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF agent_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "learning_agents" p
      WHERE p.id = agent_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.persona_messaging_templates_parent_access(persona_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF persona_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "audience_personas" p
      WHERE p.id = persona_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.persona_behavioral_signals_parent_access(persona_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF persona_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "audience_personas" p
      WHERE p.id = persona_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.fact_versions_parent_access(fact_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF fact_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "facts" p
      WHERE p.id = fact_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.oauth_credentials_parent_access(connection_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF connection_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "publishing_connections" p
      WHERE p.id = connection_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.publishing_callbacks_parent_access(publishing_job_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF publishing_job_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "publishing_jobs" p
      WHERE p.id = publishing_job_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.schedule_runs_parent_access(schedule_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF schedule_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "content_schedules" p
      WHERE p.id = schedule_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.pattern_dimension_stats_parent_access(pattern_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF pattern_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "learning_patterns" p
      WHERE p.id = pattern_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.journey_steps_parent_access(journey_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF journey_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "journeys" p
      WHERE p.id = journey_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION citefi_rls.daily_brief_deliveries_parent_access(brief_id integer)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = citefi_rls, pg_catalog, public
AS $fn$
BEGIN
  IF brief_id IS NOT NULL THEN
    RETURN EXISTS (
      SELECT 1 FROM "daily_briefs" p
      WHERE p.id = brief_id AND citefi_rls.tenant_can_access(p.team_id)
    );
  END IF;
  -- All linking columns NULL → not reachable by any tenant (system only).
  RETURN false;
END;
$fn$;
-- Re-grant execute for the newly created indirect helpers.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA citefi_rls FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA citefi_rls TO citefi_tenant;


-- ---------------------------------------------------------------------------
-- 3. Table grants (RLS is the gate, not GRANT). DML on tenant/user/identity/
--    override tables; SELECT-only on global-ref; NO grant on system-only tables.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_batches" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "article_assets" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_posts" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_clusters" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "video_ideas" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_agents" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "learning_patterns" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_performance_metrics" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "audience_personas" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "facts" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "fact_claims" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_audit_trails" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_execution_manifests" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "publishing_jobs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_schedules" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "site_pages" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "site_crawl_jobs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_learning_ledger" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_reviews" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_feedback" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "judge_recalibration_queue" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_events" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "client_intelligence" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_policies" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "decision_arms" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "holdout_assignments" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "variant_arms" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "client_brand_profiles" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cohort_insights" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "journeys" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cadence_performance" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "citation_probes" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_briefs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "cost_telemetry" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_balances" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_ledger" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "spending_caps" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_events" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "publishing_connections" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_events" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "article_runs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "batch_seo_cache" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "seo_logs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_post_variants" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_post_assets" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_post_jobs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_post_logs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "error_logs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "article_versions" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "coverage_nodes" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "agent_optimization_logs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "persona_messaging_templates" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "persona_behavioral_signals" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "fact_versions" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "oauth_credentials" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "publishing_callbacks" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "schedule_runs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "pattern_dimension_stats" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "journey_steps" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_brief_deliveries" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "totp_secrets" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_verification_codes" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "login_history" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "password_resets" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_quotas" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "used_approval_tokens" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "revoked_approval_tokens" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "articles" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_brief_preferences" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_invites" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "activity_logs" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_menu_overrides" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "teams" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "team_members" TO citefi_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO citefi_tenant;
GRANT SELECT ON "locales" TO citefi_tenant;
GRANT SELECT ON "local_authority_signals" TO citefi_tenant;
GRANT SELECT ON "journey_templates" TO citefi_tenant;
GRANT SELECT ON "maintenance_flags" TO citefi_tenant;
-- Inserts into serial/identity-backed tenant tables call nextval() as the
-- effective tenant role. RLS still governs the table row; sequence USAGE only
-- permits generation of the primary-key value.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO citefi_tenant;
-- system-only (no grant, unreachable by citefi_tenant): system_metrics, cleanup_jobs, cleanup_config, rate_limit_windows, billing_events, free_tier_grants, admin_action_logs, signup_competitor_intake


-- ---------------------------------------------------------------------------
-- 4. tenant-direct policies
-- ---------------------------------------------------------------------------

-- job_batches (tenant-direct)
ALTER TABLE "job_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_batches" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_job_batches_sel ON "job_batches";
DROP POLICY IF EXISTS rls_job_batches_ins ON "job_batches";
DROP POLICY IF EXISTS rls_job_batches_upd ON "job_batches";
DROP POLICY IF EXISTS rls_job_batches_del ON "job_batches";
CREATE POLICY rls_job_batches_sel ON "job_batches" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_job_batches_ins ON "job_batches" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_job_batches_upd ON "job_batches" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_job_batches_del ON "job_batches" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- article_assets (tenant-direct)
ALTER TABLE "article_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_article_assets_sel ON "article_assets";
DROP POLICY IF EXISTS rls_article_assets_ins ON "article_assets";
DROP POLICY IF EXISTS rls_article_assets_upd ON "article_assets";
DROP POLICY IF EXISTS rls_article_assets_del ON "article_assets";
CREATE POLICY rls_article_assets_sel ON "article_assets" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_article_assets_ins ON "article_assets" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_article_assets_upd ON "article_assets" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_article_assets_del ON "article_assets" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- social_posts (tenant-direct)
ALTER TABLE "social_posts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_posts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_social_posts_sel ON "social_posts";
DROP POLICY IF EXISTS rls_social_posts_ins ON "social_posts";
DROP POLICY IF EXISTS rls_social_posts_upd ON "social_posts";
DROP POLICY IF EXISTS rls_social_posts_del ON "social_posts";
CREATE POLICY rls_social_posts_sel ON "social_posts" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_social_posts_ins ON "social_posts" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_social_posts_upd ON "social_posts" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_social_posts_del ON "social_posts" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_clusters (tenant-direct)
ALTER TABLE "content_clusters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_clusters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_clusters_sel ON "content_clusters";
DROP POLICY IF EXISTS rls_content_clusters_ins ON "content_clusters";
DROP POLICY IF EXISTS rls_content_clusters_upd ON "content_clusters";
DROP POLICY IF EXISTS rls_content_clusters_del ON "content_clusters";
CREATE POLICY rls_content_clusters_sel ON "content_clusters" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_clusters_ins ON "content_clusters" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_clusters_upd ON "content_clusters" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_clusters_del ON "content_clusters" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- video_ideas (tenant-direct)
ALTER TABLE "video_ideas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "video_ideas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_video_ideas_sel ON "video_ideas";
DROP POLICY IF EXISTS rls_video_ideas_ins ON "video_ideas";
DROP POLICY IF EXISTS rls_video_ideas_upd ON "video_ideas";
DROP POLICY IF EXISTS rls_video_ideas_del ON "video_ideas";
CREATE POLICY rls_video_ideas_sel ON "video_ideas" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_video_ideas_ins ON "video_ideas" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_video_ideas_upd ON "video_ideas" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_video_ideas_del ON "video_ideas" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- learning_agents (tenant-direct)
ALTER TABLE "learning_agents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_agents" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_learning_agents_sel ON "learning_agents";
DROP POLICY IF EXISTS rls_learning_agents_ins ON "learning_agents";
DROP POLICY IF EXISTS rls_learning_agents_upd ON "learning_agents";
DROP POLICY IF EXISTS rls_learning_agents_del ON "learning_agents";
CREATE POLICY rls_learning_agents_sel ON "learning_agents" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_agents_ins ON "learning_agents" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_agents_upd ON "learning_agents" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_agents_del ON "learning_agents" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- learning_patterns (tenant-direct)
ALTER TABLE "learning_patterns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_patterns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_learning_patterns_sel ON "learning_patterns";
DROP POLICY IF EXISTS rls_learning_patterns_ins ON "learning_patterns";
DROP POLICY IF EXISTS rls_learning_patterns_upd ON "learning_patterns";
DROP POLICY IF EXISTS rls_learning_patterns_del ON "learning_patterns";
CREATE POLICY rls_learning_patterns_sel ON "learning_patterns" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_patterns_ins ON "learning_patterns" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_patterns_upd ON "learning_patterns" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_learning_patterns_del ON "learning_patterns" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_performance_metrics (tenant-direct)
ALTER TABLE "content_performance_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_performance_metrics" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_performance_metrics_sel ON "content_performance_metrics";
DROP POLICY IF EXISTS rls_content_performance_metrics_ins ON "content_performance_metrics";
DROP POLICY IF EXISTS rls_content_performance_metrics_upd ON "content_performance_metrics";
DROP POLICY IF EXISTS rls_content_performance_metrics_del ON "content_performance_metrics";
CREATE POLICY rls_content_performance_metrics_sel ON "content_performance_metrics" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_performance_metrics_ins ON "content_performance_metrics" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_performance_metrics_upd ON "content_performance_metrics" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_performance_metrics_del ON "content_performance_metrics" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- audience_personas (tenant-direct)
ALTER TABLE "audience_personas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audience_personas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_audience_personas_sel ON "audience_personas";
DROP POLICY IF EXISTS rls_audience_personas_ins ON "audience_personas";
DROP POLICY IF EXISTS rls_audience_personas_upd ON "audience_personas";
DROP POLICY IF EXISTS rls_audience_personas_del ON "audience_personas";
CREATE POLICY rls_audience_personas_sel ON "audience_personas" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_audience_personas_ins ON "audience_personas" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_audience_personas_upd ON "audience_personas" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_audience_personas_del ON "audience_personas" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- facts (tenant-direct)
ALTER TABLE "facts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_facts_sel ON "facts";
DROP POLICY IF EXISTS rls_facts_ins ON "facts";
DROP POLICY IF EXISTS rls_facts_upd ON "facts";
DROP POLICY IF EXISTS rls_facts_del ON "facts";
CREATE POLICY rls_facts_sel ON "facts" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_facts_ins ON "facts" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_facts_upd ON "facts" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_facts_del ON "facts" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- fact_claims (tenant-direct)
ALTER TABLE "fact_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact_claims" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fact_claims_sel ON "fact_claims";
DROP POLICY IF EXISTS rls_fact_claims_ins ON "fact_claims";
DROP POLICY IF EXISTS rls_fact_claims_upd ON "fact_claims";
DROP POLICY IF EXISTS rls_fact_claims_del ON "fact_claims";
CREATE POLICY rls_fact_claims_sel ON "fact_claims" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_fact_claims_ins ON "fact_claims" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_fact_claims_upd ON "fact_claims" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_fact_claims_del ON "fact_claims" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_audit_trails (tenant-direct)
ALTER TABLE "content_audit_trails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_audit_trails" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_audit_trails_sel ON "content_audit_trails";
DROP POLICY IF EXISTS rls_content_audit_trails_ins ON "content_audit_trails";
DROP POLICY IF EXISTS rls_content_audit_trails_upd ON "content_audit_trails";
DROP POLICY IF EXISTS rls_content_audit_trails_del ON "content_audit_trails";
CREATE POLICY rls_content_audit_trails_sel ON "content_audit_trails" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_audit_trails_ins ON "content_audit_trails" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_audit_trails_upd ON "content_audit_trails" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_audit_trails_del ON "content_audit_trails" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- agent_execution_manifests (tenant-direct)
ALTER TABLE "agent_execution_manifests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_execution_manifests" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_agent_execution_manifests_sel ON "agent_execution_manifests";
DROP POLICY IF EXISTS rls_agent_execution_manifests_ins ON "agent_execution_manifests";
DROP POLICY IF EXISTS rls_agent_execution_manifests_upd ON "agent_execution_manifests";
DROP POLICY IF EXISTS rls_agent_execution_manifests_del ON "agent_execution_manifests";
CREATE POLICY rls_agent_execution_manifests_sel ON "agent_execution_manifests" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_agent_execution_manifests_ins ON "agent_execution_manifests" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_agent_execution_manifests_upd ON "agent_execution_manifests" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_agent_execution_manifests_del ON "agent_execution_manifests" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- publishing_jobs (tenant-direct)
ALTER TABLE "publishing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_publishing_jobs_sel ON "publishing_jobs";
DROP POLICY IF EXISTS rls_publishing_jobs_ins ON "publishing_jobs";
DROP POLICY IF EXISTS rls_publishing_jobs_upd ON "publishing_jobs";
DROP POLICY IF EXISTS rls_publishing_jobs_del ON "publishing_jobs";
CREATE POLICY rls_publishing_jobs_sel ON "publishing_jobs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_publishing_jobs_ins ON "publishing_jobs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_publishing_jobs_upd ON "publishing_jobs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_publishing_jobs_del ON "publishing_jobs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_schedules (tenant-direct)
ALTER TABLE "content_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_schedules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_schedules_sel ON "content_schedules";
DROP POLICY IF EXISTS rls_content_schedules_ins ON "content_schedules";
DROP POLICY IF EXISTS rls_content_schedules_upd ON "content_schedules";
DROP POLICY IF EXISTS rls_content_schedules_del ON "content_schedules";
CREATE POLICY rls_content_schedules_sel ON "content_schedules" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_schedules_ins ON "content_schedules" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_schedules_upd ON "content_schedules" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_schedules_del ON "content_schedules" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- site_pages (tenant-direct)
ALTER TABLE "site_pages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_pages" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_site_pages_sel ON "site_pages";
DROP POLICY IF EXISTS rls_site_pages_ins ON "site_pages";
DROP POLICY IF EXISTS rls_site_pages_upd ON "site_pages";
DROP POLICY IF EXISTS rls_site_pages_del ON "site_pages";
CREATE POLICY rls_site_pages_sel ON "site_pages" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_pages_ins ON "site_pages" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_pages_upd ON "site_pages" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_pages_del ON "site_pages" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- site_crawl_jobs (tenant-direct)
ALTER TABLE "site_crawl_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "site_crawl_jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_site_crawl_jobs_sel ON "site_crawl_jobs";
DROP POLICY IF EXISTS rls_site_crawl_jobs_ins ON "site_crawl_jobs";
DROP POLICY IF EXISTS rls_site_crawl_jobs_upd ON "site_crawl_jobs";
DROP POLICY IF EXISTS rls_site_crawl_jobs_del ON "site_crawl_jobs";
CREATE POLICY rls_site_crawl_jobs_sel ON "site_crawl_jobs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_crawl_jobs_ins ON "site_crawl_jobs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_crawl_jobs_upd ON "site_crawl_jobs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_site_crawl_jobs_del ON "site_crawl_jobs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- ai_learning_ledger (tenant-direct)
ALTER TABLE "ai_learning_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_learning_ledger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_ai_learning_ledger_sel ON "ai_learning_ledger";
DROP POLICY IF EXISTS rls_ai_learning_ledger_ins ON "ai_learning_ledger";
DROP POLICY IF EXISTS rls_ai_learning_ledger_upd ON "ai_learning_ledger";
DROP POLICY IF EXISTS rls_ai_learning_ledger_del ON "ai_learning_ledger";
CREATE POLICY rls_ai_learning_ledger_sel ON "ai_learning_ledger" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_ai_learning_ledger_ins ON "ai_learning_ledger" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_ai_learning_ledger_upd ON "ai_learning_ledger" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_ai_learning_ledger_del ON "ai_learning_ledger" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_reviews (tenant-direct)
ALTER TABLE "content_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_reviews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_reviews_sel ON "content_reviews";
DROP POLICY IF EXISTS rls_content_reviews_ins ON "content_reviews";
DROP POLICY IF EXISTS rls_content_reviews_upd ON "content_reviews";
DROP POLICY IF EXISTS rls_content_reviews_del ON "content_reviews";
CREATE POLICY rls_content_reviews_sel ON "content_reviews" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_reviews_ins ON "content_reviews" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_reviews_upd ON "content_reviews" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_reviews_del ON "content_reviews" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_feedback (tenant-direct)
ALTER TABLE "content_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_feedback" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_feedback_sel ON "content_feedback";
DROP POLICY IF EXISTS rls_content_feedback_ins ON "content_feedback";
DROP POLICY IF EXISTS rls_content_feedback_upd ON "content_feedback";
DROP POLICY IF EXISTS rls_content_feedback_del ON "content_feedback";
CREATE POLICY rls_content_feedback_sel ON "content_feedback" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_feedback_ins ON "content_feedback" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_feedback_upd ON "content_feedback" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_feedback_del ON "content_feedback" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- judge_recalibration_queue (tenant-direct)
ALTER TABLE "judge_recalibration_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "judge_recalibration_queue" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_judge_recalibration_queue_sel ON "judge_recalibration_queue";
DROP POLICY IF EXISTS rls_judge_recalibration_queue_ins ON "judge_recalibration_queue";
DROP POLICY IF EXISTS rls_judge_recalibration_queue_upd ON "judge_recalibration_queue";
DROP POLICY IF EXISTS rls_judge_recalibration_queue_del ON "judge_recalibration_queue";
CREATE POLICY rls_judge_recalibration_queue_sel ON "judge_recalibration_queue" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_judge_recalibration_queue_ins ON "judge_recalibration_queue" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_judge_recalibration_queue_upd ON "judge_recalibration_queue" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_judge_recalibration_queue_del ON "judge_recalibration_queue" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- content_events (tenant-direct)
ALTER TABLE "content_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "content_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_content_events_sel ON "content_events";
DROP POLICY IF EXISTS rls_content_events_ins ON "content_events";
DROP POLICY IF EXISTS rls_content_events_upd ON "content_events";
DROP POLICY IF EXISTS rls_content_events_del ON "content_events";
CREATE POLICY rls_content_events_sel ON "content_events" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_events_ins ON "content_events" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_events_upd ON "content_events" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_content_events_del ON "content_events" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- client_intelligence (tenant-direct)
ALTER TABLE "client_intelligence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_intelligence" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_client_intelligence_sel ON "client_intelligence";
DROP POLICY IF EXISTS rls_client_intelligence_ins ON "client_intelligence";
DROP POLICY IF EXISTS rls_client_intelligence_upd ON "client_intelligence";
DROP POLICY IF EXISTS rls_client_intelligence_del ON "client_intelligence";
CREATE POLICY rls_client_intelligence_sel ON "client_intelligence" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_intelligence_ins ON "client_intelligence" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_intelligence_upd ON "client_intelligence" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_intelligence_del ON "client_intelligence" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- decision_policies (tenant-direct)
ALTER TABLE "decision_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_policies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_decision_policies_sel ON "decision_policies";
DROP POLICY IF EXISTS rls_decision_policies_ins ON "decision_policies";
DROP POLICY IF EXISTS rls_decision_policies_upd ON "decision_policies";
DROP POLICY IF EXISTS rls_decision_policies_del ON "decision_policies";
CREATE POLICY rls_decision_policies_sel ON "decision_policies" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_policies_ins ON "decision_policies" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_policies_upd ON "decision_policies" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_policies_del ON "decision_policies" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- decision_arms (tenant-direct)
ALTER TABLE "decision_arms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "decision_arms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_decision_arms_sel ON "decision_arms";
DROP POLICY IF EXISTS rls_decision_arms_ins ON "decision_arms";
DROP POLICY IF EXISTS rls_decision_arms_upd ON "decision_arms";
DROP POLICY IF EXISTS rls_decision_arms_del ON "decision_arms";
CREATE POLICY rls_decision_arms_sel ON "decision_arms" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_arms_ins ON "decision_arms" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_arms_upd ON "decision_arms" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_decision_arms_del ON "decision_arms" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- holdout_assignments (tenant-direct)
ALTER TABLE "holdout_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holdout_assignments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_holdout_assignments_sel ON "holdout_assignments";
DROP POLICY IF EXISTS rls_holdout_assignments_ins ON "holdout_assignments";
DROP POLICY IF EXISTS rls_holdout_assignments_upd ON "holdout_assignments";
DROP POLICY IF EXISTS rls_holdout_assignments_del ON "holdout_assignments";
CREATE POLICY rls_holdout_assignments_sel ON "holdout_assignments" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_holdout_assignments_ins ON "holdout_assignments" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_holdout_assignments_upd ON "holdout_assignments" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_holdout_assignments_del ON "holdout_assignments" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- variant_arms (tenant-direct)
ALTER TABLE "variant_arms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "variant_arms" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_variant_arms_sel ON "variant_arms";
DROP POLICY IF EXISTS rls_variant_arms_ins ON "variant_arms";
DROP POLICY IF EXISTS rls_variant_arms_upd ON "variant_arms";
DROP POLICY IF EXISTS rls_variant_arms_del ON "variant_arms";
CREATE POLICY rls_variant_arms_sel ON "variant_arms" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_variant_arms_ins ON "variant_arms" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_variant_arms_upd ON "variant_arms" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_variant_arms_del ON "variant_arms" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- client_brand_profiles (tenant-direct)
ALTER TABLE "client_brand_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_brand_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_client_brand_profiles_sel ON "client_brand_profiles";
DROP POLICY IF EXISTS rls_client_brand_profiles_ins ON "client_brand_profiles";
DROP POLICY IF EXISTS rls_client_brand_profiles_upd ON "client_brand_profiles";
DROP POLICY IF EXISTS rls_client_brand_profiles_del ON "client_brand_profiles";
CREATE POLICY rls_client_brand_profiles_sel ON "client_brand_profiles" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_brand_profiles_ins ON "client_brand_profiles" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_brand_profiles_upd ON "client_brand_profiles" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_client_brand_profiles_del ON "client_brand_profiles" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- cohort_insights (tenant-direct)
ALTER TABLE "cohort_insights" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cohort_insights" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cohort_insights_sel ON "cohort_insights";
DROP POLICY IF EXISTS rls_cohort_insights_ins ON "cohort_insights";
DROP POLICY IF EXISTS rls_cohort_insights_upd ON "cohort_insights";
DROP POLICY IF EXISTS rls_cohort_insights_del ON "cohort_insights";
CREATE POLICY rls_cohort_insights_sel ON "cohort_insights" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cohort_insights_ins ON "cohort_insights" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cohort_insights_upd ON "cohort_insights" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cohort_insights_del ON "cohort_insights" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- journeys (tenant-direct)
ALTER TABLE "journeys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journeys" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_journeys_sel ON "journeys";
DROP POLICY IF EXISTS rls_journeys_ins ON "journeys";
DROP POLICY IF EXISTS rls_journeys_upd ON "journeys";
DROP POLICY IF EXISTS rls_journeys_del ON "journeys";
CREATE POLICY rls_journeys_sel ON "journeys" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_journeys_ins ON "journeys" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_journeys_upd ON "journeys" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_journeys_del ON "journeys" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- cadence_performance (tenant-direct)
ALTER TABLE "cadence_performance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cadence_performance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cadence_performance_sel ON "cadence_performance";
DROP POLICY IF EXISTS rls_cadence_performance_ins ON "cadence_performance";
DROP POLICY IF EXISTS rls_cadence_performance_upd ON "cadence_performance";
DROP POLICY IF EXISTS rls_cadence_performance_del ON "cadence_performance";
CREATE POLICY rls_cadence_performance_sel ON "cadence_performance" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cadence_performance_ins ON "cadence_performance" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cadence_performance_upd ON "cadence_performance" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_cadence_performance_del ON "cadence_performance" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- citation_probes (tenant-direct)
ALTER TABLE "citation_probes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "citation_probes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_citation_probes_sel ON "citation_probes";
DROP POLICY IF EXISTS rls_citation_probes_ins ON "citation_probes";
DROP POLICY IF EXISTS rls_citation_probes_upd ON "citation_probes";
DROP POLICY IF EXISTS rls_citation_probes_del ON "citation_probes";
CREATE POLICY rls_citation_probes_sel ON "citation_probes" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_citation_probes_ins ON "citation_probes" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_citation_probes_upd ON "citation_probes" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_citation_probes_del ON "citation_probes" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- daily_briefs (tenant-direct)
ALTER TABLE "daily_briefs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_briefs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_daily_briefs_sel ON "daily_briefs";
DROP POLICY IF EXISTS rls_daily_briefs_ins ON "daily_briefs";
DROP POLICY IF EXISTS rls_daily_briefs_upd ON "daily_briefs";
DROP POLICY IF EXISTS rls_daily_briefs_del ON "daily_briefs";
CREATE POLICY rls_daily_briefs_sel ON "daily_briefs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_daily_briefs_ins ON "daily_briefs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_daily_briefs_upd ON "daily_briefs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id))
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_daily_briefs_del ON "daily_briefs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));

-- ---------------------------------------------------------------------------
-- 5. tenant-direct-sensitive policies (client_viewer denied)
-- ---------------------------------------------------------------------------

-- cost_telemetry (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "cost_telemetry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_telemetry" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_cost_telemetry_sel ON "cost_telemetry";
DROP POLICY IF EXISTS rls_cost_telemetry_ins ON "cost_telemetry";
DROP POLICY IF EXISTS rls_cost_telemetry_upd ON "cost_telemetry";
DROP POLICY IF EXISTS rls_cost_telemetry_del ON "cost_telemetry";
CREATE POLICY rls_cost_telemetry_sel ON "cost_telemetry" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_cost_telemetry_ins ON "cost_telemetry" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_cost_telemetry_upd ON "cost_telemetry" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_cost_telemetry_del ON "cost_telemetry" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- credit_balances (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "credit_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_balances" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_credit_balances_sel ON "credit_balances";
DROP POLICY IF EXISTS rls_credit_balances_ins ON "credit_balances";
DROP POLICY IF EXISTS rls_credit_balances_upd ON "credit_balances";
DROP POLICY IF EXISTS rls_credit_balances_del ON "credit_balances";
CREATE POLICY rls_credit_balances_sel ON "credit_balances" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_balances_ins ON "credit_balances" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_balances_upd ON "credit_balances" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_balances_del ON "credit_balances" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- credit_ledger (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_ledger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_credit_ledger_sel ON "credit_ledger";
DROP POLICY IF EXISTS rls_credit_ledger_ins ON "credit_ledger";
DROP POLICY IF EXISTS rls_credit_ledger_upd ON "credit_ledger";
DROP POLICY IF EXISTS rls_credit_ledger_del ON "credit_ledger";
CREATE POLICY rls_credit_ledger_sel ON "credit_ledger" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_ledger_ins ON "credit_ledger" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_ledger_upd ON "credit_ledger" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_credit_ledger_del ON "credit_ledger" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- spending_caps (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "spending_caps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spending_caps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_spending_caps_sel ON "spending_caps";
DROP POLICY IF EXISTS rls_spending_caps_ins ON "spending_caps";
DROP POLICY IF EXISTS rls_spending_caps_upd ON "spending_caps";
DROP POLICY IF EXISTS rls_spending_caps_del ON "spending_caps";
CREATE POLICY rls_spending_caps_sel ON "spending_caps" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_spending_caps_ins ON "spending_caps" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_spending_caps_upd ON "spending_caps" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_spending_caps_del ON "spending_caps" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- usage_events (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_usage_events_sel ON "usage_events";
DROP POLICY IF EXISTS rls_usage_events_ins ON "usage_events";
DROP POLICY IF EXISTS rls_usage_events_upd ON "usage_events";
DROP POLICY IF EXISTS rls_usage_events_del ON "usage_events";
CREATE POLICY rls_usage_events_sel ON "usage_events" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_usage_events_ins ON "usage_events" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_usage_events_upd ON "usage_events" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_usage_events_del ON "usage_events" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- publishing_connections (tenant-direct-sensitive: client_viewer denied)
ALTER TABLE "publishing_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_connections" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_publishing_connections_sel ON "publishing_connections";
DROP POLICY IF EXISTS rls_publishing_connections_ins ON "publishing_connections";
DROP POLICY IF EXISTS rls_publishing_connections_upd ON "publishing_connections";
DROP POLICY IF EXISTS rls_publishing_connections_del ON "publishing_connections";
CREATE POLICY rls_publishing_connections_sel ON "publishing_connections" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_publishing_connections_ins ON "publishing_connections" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_publishing_connections_upd ON "publishing_connections" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_publishing_connections_del ON "publishing_connections" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

-- ---------------------------------------------------------------------------
-- 6. tenant-indirect policies (parent-resolved via SECURITY DEFINER helpers)
-- ---------------------------------------------------------------------------

-- job_events (tenant-indirect via batch_id→job_batches, article_id→articles)
ALTER TABLE "job_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_job_events_sel ON "job_events";
DROP POLICY IF EXISTS rls_job_events_ins ON "job_events";
DROP POLICY IF EXISTS rls_job_events_upd ON "job_events";
DROP POLICY IF EXISTS rls_job_events_del ON "job_events";
CREATE POLICY rls_job_events_sel ON "job_events" FOR SELECT TO citefi_tenant
  USING (citefi_rls.job_events_parent_access(batch_id, article_id));
CREATE POLICY rls_job_events_ins ON "job_events" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.job_events_parent_access(batch_id, article_id));
CREATE POLICY rls_job_events_upd ON "job_events" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.job_events_parent_access(batch_id, article_id)) WITH CHECK (citefi_rls.job_events_parent_access(batch_id, article_id));
CREATE POLICY rls_job_events_del ON "job_events" FOR DELETE TO citefi_tenant
  USING (citefi_rls.job_events_parent_access(batch_id, article_id));

-- article_runs (tenant-indirect via article_id→articles; sensitive)
ALTER TABLE "article_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_article_runs_sel ON "article_runs";
DROP POLICY IF EXISTS rls_article_runs_ins ON "article_runs";
DROP POLICY IF EXISTS rls_article_runs_upd ON "article_runs";
DROP POLICY IF EXISTS rls_article_runs_del ON "article_runs";
CREATE POLICY rls_article_runs_sel ON "article_runs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.article_runs_parent_access(article_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_article_runs_ins ON "article_runs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.article_runs_parent_access(article_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_article_runs_upd ON "article_runs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.article_runs_parent_access(article_id) AND NOT citefi_rls.is_client_viewer()) WITH CHECK (citefi_rls.article_runs_parent_access(article_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_article_runs_del ON "article_runs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.article_runs_parent_access(article_id) AND NOT citefi_rls.is_client_viewer());

-- batch_seo_cache (tenant-indirect via batch_id→job_batches)
ALTER TABLE "batch_seo_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "batch_seo_cache" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_batch_seo_cache_sel ON "batch_seo_cache";
DROP POLICY IF EXISTS rls_batch_seo_cache_ins ON "batch_seo_cache";
DROP POLICY IF EXISTS rls_batch_seo_cache_upd ON "batch_seo_cache";
DROP POLICY IF EXISTS rls_batch_seo_cache_del ON "batch_seo_cache";
CREATE POLICY rls_batch_seo_cache_sel ON "batch_seo_cache" FOR SELECT TO citefi_tenant
  USING (citefi_rls.batch_seo_cache_parent_access(batch_id));
CREATE POLICY rls_batch_seo_cache_ins ON "batch_seo_cache" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.batch_seo_cache_parent_access(batch_id));
CREATE POLICY rls_batch_seo_cache_upd ON "batch_seo_cache" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.batch_seo_cache_parent_access(batch_id)) WITH CHECK (citefi_rls.batch_seo_cache_parent_access(batch_id));
CREATE POLICY rls_batch_seo_cache_del ON "batch_seo_cache" FOR DELETE TO citefi_tenant
  USING (citefi_rls.batch_seo_cache_parent_access(batch_id));

-- seo_logs (tenant-indirect via article_id→articles)
ALTER TABLE "seo_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "seo_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_seo_logs_sel ON "seo_logs";
DROP POLICY IF EXISTS rls_seo_logs_ins ON "seo_logs";
DROP POLICY IF EXISTS rls_seo_logs_upd ON "seo_logs";
DROP POLICY IF EXISTS rls_seo_logs_del ON "seo_logs";
CREATE POLICY rls_seo_logs_sel ON "seo_logs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.seo_logs_parent_access(article_id));
CREATE POLICY rls_seo_logs_ins ON "seo_logs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.seo_logs_parent_access(article_id));
CREATE POLICY rls_seo_logs_upd ON "seo_logs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.seo_logs_parent_access(article_id)) WITH CHECK (citefi_rls.seo_logs_parent_access(article_id));
CREATE POLICY rls_seo_logs_del ON "seo_logs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.seo_logs_parent_access(article_id));

-- social_post_variants (tenant-indirect via social_post_id→social_posts)
ALTER TABLE "social_post_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_variants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_social_post_variants_sel ON "social_post_variants";
DROP POLICY IF EXISTS rls_social_post_variants_ins ON "social_post_variants";
DROP POLICY IF EXISTS rls_social_post_variants_upd ON "social_post_variants";
DROP POLICY IF EXISTS rls_social_post_variants_del ON "social_post_variants";
CREATE POLICY rls_social_post_variants_sel ON "social_post_variants" FOR SELECT TO citefi_tenant
  USING (citefi_rls.social_post_variants_parent_access(social_post_id));
CREATE POLICY rls_social_post_variants_ins ON "social_post_variants" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.social_post_variants_parent_access(social_post_id));
CREATE POLICY rls_social_post_variants_upd ON "social_post_variants" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.social_post_variants_parent_access(social_post_id)) WITH CHECK (citefi_rls.social_post_variants_parent_access(social_post_id));
CREATE POLICY rls_social_post_variants_del ON "social_post_variants" FOR DELETE TO citefi_tenant
  USING (citefi_rls.social_post_variants_parent_access(social_post_id));

-- social_post_assets (tenant-indirect via social_post_id→social_posts)
ALTER TABLE "social_post_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_assets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_social_post_assets_sel ON "social_post_assets";
DROP POLICY IF EXISTS rls_social_post_assets_ins ON "social_post_assets";
DROP POLICY IF EXISTS rls_social_post_assets_upd ON "social_post_assets";
DROP POLICY IF EXISTS rls_social_post_assets_del ON "social_post_assets";
CREATE POLICY rls_social_post_assets_sel ON "social_post_assets" FOR SELECT TO citefi_tenant
  USING (citefi_rls.social_post_assets_parent_access(social_post_id));
CREATE POLICY rls_social_post_assets_ins ON "social_post_assets" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.social_post_assets_parent_access(social_post_id));
CREATE POLICY rls_social_post_assets_upd ON "social_post_assets" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.social_post_assets_parent_access(social_post_id)) WITH CHECK (citefi_rls.social_post_assets_parent_access(social_post_id));
CREATE POLICY rls_social_post_assets_del ON "social_post_assets" FOR DELETE TO citefi_tenant
  USING (citefi_rls.social_post_assets_parent_access(social_post_id));

-- social_post_jobs (tenant-indirect via social_post_id→social_posts)
ALTER TABLE "social_post_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_jobs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_social_post_jobs_sel ON "social_post_jobs";
DROP POLICY IF EXISTS rls_social_post_jobs_ins ON "social_post_jobs";
DROP POLICY IF EXISTS rls_social_post_jobs_upd ON "social_post_jobs";
DROP POLICY IF EXISTS rls_social_post_jobs_del ON "social_post_jobs";
CREATE POLICY rls_social_post_jobs_sel ON "social_post_jobs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.social_post_jobs_parent_access(social_post_id));
CREATE POLICY rls_social_post_jobs_ins ON "social_post_jobs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.social_post_jobs_parent_access(social_post_id));
CREATE POLICY rls_social_post_jobs_upd ON "social_post_jobs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.social_post_jobs_parent_access(social_post_id)) WITH CHECK (citefi_rls.social_post_jobs_parent_access(social_post_id));
CREATE POLICY rls_social_post_jobs_del ON "social_post_jobs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.social_post_jobs_parent_access(social_post_id));

-- social_post_logs (tenant-indirect via social_post_id→social_posts)
ALTER TABLE "social_post_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_post_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_social_post_logs_sel ON "social_post_logs";
DROP POLICY IF EXISTS rls_social_post_logs_ins ON "social_post_logs";
DROP POLICY IF EXISTS rls_social_post_logs_upd ON "social_post_logs";
DROP POLICY IF EXISTS rls_social_post_logs_del ON "social_post_logs";
CREATE POLICY rls_social_post_logs_sel ON "social_post_logs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.social_post_logs_parent_access(social_post_id));
CREATE POLICY rls_social_post_logs_ins ON "social_post_logs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.social_post_logs_parent_access(social_post_id));
CREATE POLICY rls_social_post_logs_upd ON "social_post_logs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.social_post_logs_parent_access(social_post_id)) WITH CHECK (citefi_rls.social_post_logs_parent_access(social_post_id));
CREATE POLICY rls_social_post_logs_del ON "social_post_logs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.social_post_logs_parent_access(social_post_id));

-- error_logs (tenant-indirect via batch_id→job_batches, article_id→articles)
ALTER TABLE "error_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "error_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_error_logs_sel ON "error_logs";
DROP POLICY IF EXISTS rls_error_logs_ins ON "error_logs";
DROP POLICY IF EXISTS rls_error_logs_upd ON "error_logs";
DROP POLICY IF EXISTS rls_error_logs_del ON "error_logs";
CREATE POLICY rls_error_logs_sel ON "error_logs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.error_logs_parent_access(batch_id, article_id));
CREATE POLICY rls_error_logs_ins ON "error_logs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.error_logs_parent_access(batch_id, article_id));
CREATE POLICY rls_error_logs_upd ON "error_logs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.error_logs_parent_access(batch_id, article_id)) WITH CHECK (citefi_rls.error_logs_parent_access(batch_id, article_id));
CREATE POLICY rls_error_logs_del ON "error_logs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.error_logs_parent_access(batch_id, article_id));

-- article_versions (tenant-indirect via article_id→articles)
ALTER TABLE "article_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "article_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_article_versions_sel ON "article_versions";
DROP POLICY IF EXISTS rls_article_versions_ins ON "article_versions";
DROP POLICY IF EXISTS rls_article_versions_upd ON "article_versions";
DROP POLICY IF EXISTS rls_article_versions_del ON "article_versions";
CREATE POLICY rls_article_versions_sel ON "article_versions" FOR SELECT TO citefi_tenant
  USING (citefi_rls.article_versions_parent_access(article_id));
CREATE POLICY rls_article_versions_ins ON "article_versions" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.article_versions_parent_access(article_id));
CREATE POLICY rls_article_versions_upd ON "article_versions" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.article_versions_parent_access(article_id)) WITH CHECK (citefi_rls.article_versions_parent_access(article_id));
CREATE POLICY rls_article_versions_del ON "article_versions" FOR DELETE TO citefi_tenant
  USING (citefi_rls.article_versions_parent_access(article_id));

-- coverage_nodes (tenant-indirect via cluster_id→content_clusters)
ALTER TABLE "coverage_nodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coverage_nodes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_coverage_nodes_sel ON "coverage_nodes";
DROP POLICY IF EXISTS rls_coverage_nodes_ins ON "coverage_nodes";
DROP POLICY IF EXISTS rls_coverage_nodes_upd ON "coverage_nodes";
DROP POLICY IF EXISTS rls_coverage_nodes_del ON "coverage_nodes";
CREATE POLICY rls_coverage_nodes_sel ON "coverage_nodes" FOR SELECT TO citefi_tenant
  USING (citefi_rls.coverage_nodes_parent_access(cluster_id));
CREATE POLICY rls_coverage_nodes_ins ON "coverage_nodes" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.coverage_nodes_parent_access(cluster_id));
CREATE POLICY rls_coverage_nodes_upd ON "coverage_nodes" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.coverage_nodes_parent_access(cluster_id)) WITH CHECK (citefi_rls.coverage_nodes_parent_access(cluster_id));
CREATE POLICY rls_coverage_nodes_del ON "coverage_nodes" FOR DELETE TO citefi_tenant
  USING (citefi_rls.coverage_nodes_parent_access(cluster_id));

-- agent_optimization_logs (tenant-indirect via agent_id→learning_agents)
ALTER TABLE "agent_optimization_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "agent_optimization_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_agent_optimization_logs_sel ON "agent_optimization_logs";
DROP POLICY IF EXISTS rls_agent_optimization_logs_ins ON "agent_optimization_logs";
DROP POLICY IF EXISTS rls_agent_optimization_logs_upd ON "agent_optimization_logs";
DROP POLICY IF EXISTS rls_agent_optimization_logs_del ON "agent_optimization_logs";
CREATE POLICY rls_agent_optimization_logs_sel ON "agent_optimization_logs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.agent_optimization_logs_parent_access(agent_id));
CREATE POLICY rls_agent_optimization_logs_ins ON "agent_optimization_logs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.agent_optimization_logs_parent_access(agent_id));
CREATE POLICY rls_agent_optimization_logs_upd ON "agent_optimization_logs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.agent_optimization_logs_parent_access(agent_id)) WITH CHECK (citefi_rls.agent_optimization_logs_parent_access(agent_id));
CREATE POLICY rls_agent_optimization_logs_del ON "agent_optimization_logs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.agent_optimization_logs_parent_access(agent_id));

-- persona_messaging_templates (tenant-indirect via persona_id→audience_personas)
ALTER TABLE "persona_messaging_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "persona_messaging_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_persona_messaging_templates_sel ON "persona_messaging_templates";
DROP POLICY IF EXISTS rls_persona_messaging_templates_ins ON "persona_messaging_templates";
DROP POLICY IF EXISTS rls_persona_messaging_templates_upd ON "persona_messaging_templates";
DROP POLICY IF EXISTS rls_persona_messaging_templates_del ON "persona_messaging_templates";
CREATE POLICY rls_persona_messaging_templates_sel ON "persona_messaging_templates" FOR SELECT TO citefi_tenant
  USING (citefi_rls.persona_messaging_templates_parent_access(persona_id));
CREATE POLICY rls_persona_messaging_templates_ins ON "persona_messaging_templates" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.persona_messaging_templates_parent_access(persona_id));
CREATE POLICY rls_persona_messaging_templates_upd ON "persona_messaging_templates" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.persona_messaging_templates_parent_access(persona_id)) WITH CHECK (citefi_rls.persona_messaging_templates_parent_access(persona_id));
CREATE POLICY rls_persona_messaging_templates_del ON "persona_messaging_templates" FOR DELETE TO citefi_tenant
  USING (citefi_rls.persona_messaging_templates_parent_access(persona_id));

-- persona_behavioral_signals (tenant-indirect via persona_id→audience_personas)
ALTER TABLE "persona_behavioral_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "persona_behavioral_signals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_persona_behavioral_signals_sel ON "persona_behavioral_signals";
DROP POLICY IF EXISTS rls_persona_behavioral_signals_ins ON "persona_behavioral_signals";
DROP POLICY IF EXISTS rls_persona_behavioral_signals_upd ON "persona_behavioral_signals";
DROP POLICY IF EXISTS rls_persona_behavioral_signals_del ON "persona_behavioral_signals";
CREATE POLICY rls_persona_behavioral_signals_sel ON "persona_behavioral_signals" FOR SELECT TO citefi_tenant
  USING (citefi_rls.persona_behavioral_signals_parent_access(persona_id));
CREATE POLICY rls_persona_behavioral_signals_ins ON "persona_behavioral_signals" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.persona_behavioral_signals_parent_access(persona_id));
CREATE POLICY rls_persona_behavioral_signals_upd ON "persona_behavioral_signals" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.persona_behavioral_signals_parent_access(persona_id)) WITH CHECK (citefi_rls.persona_behavioral_signals_parent_access(persona_id));
CREATE POLICY rls_persona_behavioral_signals_del ON "persona_behavioral_signals" FOR DELETE TO citefi_tenant
  USING (citefi_rls.persona_behavioral_signals_parent_access(persona_id));

-- fact_versions (tenant-indirect via fact_id→facts)
ALTER TABLE "fact_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fact_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_fact_versions_sel ON "fact_versions";
DROP POLICY IF EXISTS rls_fact_versions_ins ON "fact_versions";
DROP POLICY IF EXISTS rls_fact_versions_upd ON "fact_versions";
DROP POLICY IF EXISTS rls_fact_versions_del ON "fact_versions";
CREATE POLICY rls_fact_versions_sel ON "fact_versions" FOR SELECT TO citefi_tenant
  USING (citefi_rls.fact_versions_parent_access(fact_id));
CREATE POLICY rls_fact_versions_ins ON "fact_versions" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.fact_versions_parent_access(fact_id));
CREATE POLICY rls_fact_versions_upd ON "fact_versions" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.fact_versions_parent_access(fact_id)) WITH CHECK (citefi_rls.fact_versions_parent_access(fact_id));
CREATE POLICY rls_fact_versions_del ON "fact_versions" FOR DELETE TO citefi_tenant
  USING (citefi_rls.fact_versions_parent_access(fact_id));

-- oauth_credentials (tenant-indirect via connection_id→publishing_connections; sensitive)
ALTER TABLE "oauth_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_credentials" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_oauth_credentials_sel ON "oauth_credentials";
DROP POLICY IF EXISTS rls_oauth_credentials_ins ON "oauth_credentials";
DROP POLICY IF EXISTS rls_oauth_credentials_upd ON "oauth_credentials";
DROP POLICY IF EXISTS rls_oauth_credentials_del ON "oauth_credentials";
CREATE POLICY rls_oauth_credentials_sel ON "oauth_credentials" FOR SELECT TO citefi_tenant
  USING (citefi_rls.oauth_credentials_parent_access(connection_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_oauth_credentials_ins ON "oauth_credentials" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.oauth_credentials_parent_access(connection_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_oauth_credentials_upd ON "oauth_credentials" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.oauth_credentials_parent_access(connection_id) AND NOT citefi_rls.is_client_viewer()) WITH CHECK (citefi_rls.oauth_credentials_parent_access(connection_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_oauth_credentials_del ON "oauth_credentials" FOR DELETE TO citefi_tenant
  USING (citefi_rls.oauth_credentials_parent_access(connection_id) AND NOT citefi_rls.is_client_viewer());

-- publishing_callbacks (tenant-indirect via publishing_job_id→publishing_jobs)
ALTER TABLE "publishing_callbacks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "publishing_callbacks" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_publishing_callbacks_sel ON "publishing_callbacks";
DROP POLICY IF EXISTS rls_publishing_callbacks_ins ON "publishing_callbacks";
DROP POLICY IF EXISTS rls_publishing_callbacks_upd ON "publishing_callbacks";
DROP POLICY IF EXISTS rls_publishing_callbacks_del ON "publishing_callbacks";
CREATE POLICY rls_publishing_callbacks_sel ON "publishing_callbacks" FOR SELECT TO citefi_tenant
  USING (citefi_rls.publishing_callbacks_parent_access(publishing_job_id));
CREATE POLICY rls_publishing_callbacks_ins ON "publishing_callbacks" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.publishing_callbacks_parent_access(publishing_job_id));
CREATE POLICY rls_publishing_callbacks_upd ON "publishing_callbacks" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.publishing_callbacks_parent_access(publishing_job_id)) WITH CHECK (citefi_rls.publishing_callbacks_parent_access(publishing_job_id));
CREATE POLICY rls_publishing_callbacks_del ON "publishing_callbacks" FOR DELETE TO citefi_tenant
  USING (citefi_rls.publishing_callbacks_parent_access(publishing_job_id));

-- schedule_runs (tenant-indirect via schedule_id→content_schedules)
ALTER TABLE "schedule_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_schedule_runs_sel ON "schedule_runs";
DROP POLICY IF EXISTS rls_schedule_runs_ins ON "schedule_runs";
DROP POLICY IF EXISTS rls_schedule_runs_upd ON "schedule_runs";
DROP POLICY IF EXISTS rls_schedule_runs_del ON "schedule_runs";
CREATE POLICY rls_schedule_runs_sel ON "schedule_runs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.schedule_runs_parent_access(schedule_id));
CREATE POLICY rls_schedule_runs_ins ON "schedule_runs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.schedule_runs_parent_access(schedule_id));
CREATE POLICY rls_schedule_runs_upd ON "schedule_runs" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.schedule_runs_parent_access(schedule_id)) WITH CHECK (citefi_rls.schedule_runs_parent_access(schedule_id));
CREATE POLICY rls_schedule_runs_del ON "schedule_runs" FOR DELETE TO citefi_tenant
  USING (citefi_rls.schedule_runs_parent_access(schedule_id));

-- pattern_dimension_stats (tenant-indirect via pattern_id→learning_patterns)
ALTER TABLE "pattern_dimension_stats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pattern_dimension_stats" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_pattern_dimension_stats_sel ON "pattern_dimension_stats";
DROP POLICY IF EXISTS rls_pattern_dimension_stats_ins ON "pattern_dimension_stats";
DROP POLICY IF EXISTS rls_pattern_dimension_stats_upd ON "pattern_dimension_stats";
DROP POLICY IF EXISTS rls_pattern_dimension_stats_del ON "pattern_dimension_stats";
CREATE POLICY rls_pattern_dimension_stats_sel ON "pattern_dimension_stats" FOR SELECT TO citefi_tenant
  USING (citefi_rls.pattern_dimension_stats_parent_access(pattern_id));
CREATE POLICY rls_pattern_dimension_stats_ins ON "pattern_dimension_stats" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.pattern_dimension_stats_parent_access(pattern_id));
CREATE POLICY rls_pattern_dimension_stats_upd ON "pattern_dimension_stats" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.pattern_dimension_stats_parent_access(pattern_id)) WITH CHECK (citefi_rls.pattern_dimension_stats_parent_access(pattern_id));
CREATE POLICY rls_pattern_dimension_stats_del ON "pattern_dimension_stats" FOR DELETE TO citefi_tenant
  USING (citefi_rls.pattern_dimension_stats_parent_access(pattern_id));

-- journey_steps (tenant-indirect via journey_id→journeys)
ALTER TABLE "journey_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey_steps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_journey_steps_sel ON "journey_steps";
DROP POLICY IF EXISTS rls_journey_steps_ins ON "journey_steps";
DROP POLICY IF EXISTS rls_journey_steps_upd ON "journey_steps";
DROP POLICY IF EXISTS rls_journey_steps_del ON "journey_steps";
CREATE POLICY rls_journey_steps_sel ON "journey_steps" FOR SELECT TO citefi_tenant
  USING (citefi_rls.journey_steps_parent_access(journey_id));
CREATE POLICY rls_journey_steps_ins ON "journey_steps" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.journey_steps_parent_access(journey_id));
CREATE POLICY rls_journey_steps_upd ON "journey_steps" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.journey_steps_parent_access(journey_id)) WITH CHECK (citefi_rls.journey_steps_parent_access(journey_id));
CREATE POLICY rls_journey_steps_del ON "journey_steps" FOR DELETE TO citefi_tenant
  USING (citefi_rls.journey_steps_parent_access(journey_id));

-- daily_brief_deliveries (tenant-indirect via brief_id→daily_briefs)
ALTER TABLE "daily_brief_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_brief_deliveries" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_daily_brief_deliveries_sel ON "daily_brief_deliveries";
DROP POLICY IF EXISTS rls_daily_brief_deliveries_ins ON "daily_brief_deliveries";
DROP POLICY IF EXISTS rls_daily_brief_deliveries_upd ON "daily_brief_deliveries";
DROP POLICY IF EXISTS rls_daily_brief_deliveries_del ON "daily_brief_deliveries";
CREATE POLICY rls_daily_brief_deliveries_sel ON "daily_brief_deliveries" FOR SELECT TO citefi_tenant
  USING (citefi_rls.daily_brief_deliveries_parent_access(brief_id));
CREATE POLICY rls_daily_brief_deliveries_ins ON "daily_brief_deliveries" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.daily_brief_deliveries_parent_access(brief_id));
CREATE POLICY rls_daily_brief_deliveries_upd ON "daily_brief_deliveries" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.daily_brief_deliveries_parent_access(brief_id)) WITH CHECK (citefi_rls.daily_brief_deliveries_parent_access(brief_id));
CREATE POLICY rls_daily_brief_deliveries_del ON "daily_brief_deliveries" FOR DELETE TO citefi_tenant
  USING (citefi_rls.daily_brief_deliveries_parent_access(brief_id));

-- ---------------------------------------------------------------------------
-- 7. user-scoped policies (self rows via citefi.user_id)
-- ---------------------------------------------------------------------------
-- sessions (user)
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_sessions_sel ON "sessions";
DROP POLICY IF EXISTS rls_sessions_ins ON "sessions";
DROP POLICY IF EXISTS rls_sessions_upd ON "sessions";
DROP POLICY IF EXISTS rls_sessions_del ON "sessions";
CREATE POLICY rls_sessions_sel ON "sessions" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_sessions_ins ON "sessions" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_sessions_upd ON "sessions" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_sessions_del ON "sessions" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- totp_secrets (user)
ALTER TABLE "totp_secrets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "totp_secrets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_totp_secrets_sel ON "totp_secrets";
DROP POLICY IF EXISTS rls_totp_secrets_ins ON "totp_secrets";
DROP POLICY IF EXISTS rls_totp_secrets_upd ON "totp_secrets";
DROP POLICY IF EXISTS rls_totp_secrets_del ON "totp_secrets";
CREATE POLICY rls_totp_secrets_sel ON "totp_secrets" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_totp_secrets_ins ON "totp_secrets" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_totp_secrets_upd ON "totp_secrets" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_totp_secrets_del ON "totp_secrets" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- email_verification_codes (user)
ALTER TABLE "email_verification_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_verification_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_email_verification_codes_sel ON "email_verification_codes";
DROP POLICY IF EXISTS rls_email_verification_codes_ins ON "email_verification_codes";
DROP POLICY IF EXISTS rls_email_verification_codes_upd ON "email_verification_codes";
DROP POLICY IF EXISTS rls_email_verification_codes_del ON "email_verification_codes";
CREATE POLICY rls_email_verification_codes_sel ON "email_verification_codes" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_email_verification_codes_ins ON "email_verification_codes" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_email_verification_codes_upd ON "email_verification_codes" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_email_verification_codes_del ON "email_verification_codes" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- login_history (user)
ALTER TABLE "login_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_history" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_login_history_sel ON "login_history";
DROP POLICY IF EXISTS rls_login_history_ins ON "login_history";
DROP POLICY IF EXISTS rls_login_history_upd ON "login_history";
DROP POLICY IF EXISTS rls_login_history_del ON "login_history";
CREATE POLICY rls_login_history_sel ON "login_history" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_login_history_ins ON "login_history" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_login_history_upd ON "login_history" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_login_history_del ON "login_history" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- password_resets (user)
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_resets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_password_resets_sel ON "password_resets";
DROP POLICY IF EXISTS rls_password_resets_ins ON "password_resets";
DROP POLICY IF EXISTS rls_password_resets_upd ON "password_resets";
DROP POLICY IF EXISTS rls_password_resets_del ON "password_resets";
CREATE POLICY rls_password_resets_sel ON "password_resets" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_password_resets_ins ON "password_resets" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_password_resets_upd ON "password_resets" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_password_resets_del ON "password_resets" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- user_quotas (user)
ALTER TABLE "user_quotas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_quotas" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_user_quotas_sel ON "user_quotas";
DROP POLICY IF EXISTS rls_user_quotas_ins ON "user_quotas";
DROP POLICY IF EXISTS rls_user_quotas_upd ON "user_quotas";
DROP POLICY IF EXISTS rls_user_quotas_del ON "user_quotas";
CREATE POLICY rls_user_quotas_sel ON "user_quotas" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_user_quotas_ins ON "user_quotas" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_user_quotas_upd ON "user_quotas" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_user_quotas_del ON "user_quotas" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- used_approval_tokens (user)
ALTER TABLE "used_approval_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "used_approval_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_used_approval_tokens_sel ON "used_approval_tokens";
DROP POLICY IF EXISTS rls_used_approval_tokens_ins ON "used_approval_tokens";
DROP POLICY IF EXISTS rls_used_approval_tokens_upd ON "used_approval_tokens";
DROP POLICY IF EXISTS rls_used_approval_tokens_del ON "used_approval_tokens";
CREATE POLICY rls_used_approval_tokens_sel ON "used_approval_tokens" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_used_approval_tokens_ins ON "used_approval_tokens" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_used_approval_tokens_upd ON "used_approval_tokens" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_used_approval_tokens_del ON "used_approval_tokens" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
-- revoked_approval_tokens (user)
ALTER TABLE "revoked_approval_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "revoked_approval_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_revoked_approval_tokens_sel ON "revoked_approval_tokens";
DROP POLICY IF EXISTS rls_revoked_approval_tokens_ins ON "revoked_approval_tokens";
DROP POLICY IF EXISTS rls_revoked_approval_tokens_upd ON "revoked_approval_tokens";
DROP POLICY IF EXISTS rls_revoked_approval_tokens_del ON "revoked_approval_tokens";
CREATE POLICY rls_revoked_approval_tokens_sel ON "revoked_approval_tokens" FOR SELECT TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_revoked_approval_tokens_ins ON "revoked_approval_tokens" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_revoked_approval_tokens_upd ON "revoked_approval_tokens" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id())
  WITH CHECK (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());
CREATE POLICY rls_revoked_approval_tokens_del ON "revoked_approval_tokens" FOR DELETE TO citefi_tenant
  USING (citefi_rls.current_user_id() IS NOT NULL AND user_id = citefi_rls.current_user_id());

-- ---------------------------------------------------------------------------
-- 8. global-ref policies (read-all for any tenant actor; writes = system only)
-- ---------------------------------------------------------------------------
-- locales (global-ref)
ALTER TABLE "locales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locales" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_locales_sel ON "locales";
CREATE POLICY rls_locales_sel ON "locales" FOR SELECT TO citefi_tenant USING (true);
-- local_authority_signals (global-ref)
ALTER TABLE "local_authority_signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "local_authority_signals" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_local_authority_signals_sel ON "local_authority_signals";
CREATE POLICY rls_local_authority_signals_sel ON "local_authority_signals" FOR SELECT TO citefi_tenant USING (true);
-- journey_templates (global-ref)
ALTER TABLE "journey_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journey_templates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_journey_templates_sel ON "journey_templates";
CREATE POLICY rls_journey_templates_sel ON "journey_templates" FOR SELECT TO citefi_tenant USING (true);
-- maintenance_flags (global-ref)
ALTER TABLE "maintenance_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "maintenance_flags" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_maintenance_flags_sel ON "maintenance_flags";
CREATE POLICY rls_maintenance_flags_sel ON "maintenance_flags" FOR SELECT TO citefi_tenant USING (true);

-- ---------------------------------------------------------------------------
-- 9. Bespoke / special-case policies
-- ---------------------------------------------------------------------------

-- teams (hierarchy): read own team, its parent agency, and its client children;
-- write only when the actor is admin of the team or its parent agency.
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_teams_sel ON "teams";
DROP POLICY IF EXISTS rls_teams_upd ON "teams";
CREATE POLICY rls_teams_sel ON "teams" FOR SELECT TO citefi_tenant
  USING (citefi_rls.team_in_context_hierarchy(id));
CREATE POLICY rls_teams_upd ON "teams" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()))
  WITH CHECK (citefi_rls.tenant_can_access(id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()));
-- INSERT/DELETE of teams reserved for the system path (no tenant policy).

-- team_members (hierarchy / identity boundary): read own-team rows (+ agency
-- parent/child); write reserved to admins of the owning team (else system).
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_team_members_sel ON "team_members";
DROP POLICY IF EXISTS rls_team_members_ins ON "team_members";
DROP POLICY IF EXISTS rls_team_members_upd ON "team_members";
DROP POLICY IF EXISTS rls_team_members_del ON "team_members";
CREATE POLICY rls_team_members_sel ON "team_members" FOR SELECT TO citefi_tenant
  USING (citefi_rls.team_in_context_hierarchy(team_id));
CREATE POLICY rls_team_members_ins ON "team_members" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()));
CREATE POLICY rls_team_members_upd ON "team_members" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()))
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()));
CREATE POLICY rls_team_members_del ON "team_members" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() IN ('owner', 'admin') OR citefi_rls.is_platform_admin()));

-- users (identity boundary): read self + users sharing an active team; write self only.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_users_sel ON "users";
DROP POLICY IF EXISTS rls_users_upd ON "users";
CREATE POLICY rls_users_sel ON "users" FOR SELECT TO citefi_tenant
  USING (
    id = citefi_rls.current_user_id()
    OR citefi_rls.user_shares_current_team(id)
  );
CREATE POLICY rls_users_upd ON "users" FOR UPDATE TO citefi_tenant
  USING (id = citefi_rls.current_user_id())
  WITH CHECK (id = citefi_rls.current_user_id());
-- INSERT/DELETE of users reserved for the system path.

-- activity_logs (tenant-audit): read own team; INSERT-only (append), no client_viewer.
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_activity_logs_sel ON "activity_logs";
DROP POLICY IF EXISTS rls_activity_logs_ins ON "activity_logs";
CREATE POLICY rls_activity_logs_sel ON "activity_logs" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_activity_logs_ins ON "activity_logs" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
-- No UPDATE/DELETE policy → append-only for tenants (system may purge).

-- user_invites (tenant-direct, admin-managed): read own team; write admins only.
ALTER TABLE "user_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_invites" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_user_invites_sel ON "user_invites";
DROP POLICY IF EXISTS rls_user_invites_ins ON "user_invites";
DROP POLICY IF EXISTS rls_user_invites_upd ON "user_invites";
DROP POLICY IF EXISTS rls_user_invites_del ON "user_invites";
CREATE POLICY rls_user_invites_sel ON "user_invites" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_user_invites_ins ON "user_invites" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() = 'admin' OR citefi_rls.is_platform_admin()));
CREATE POLICY rls_user_invites_upd ON "user_invites" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() = 'admin' OR citefi_rls.is_platform_admin()))
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() = 'admin' OR citefi_rls.is_platform_admin()));
CREATE POLICY rls_user_invites_del ON "user_invites" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND (citefi_rls.member_role() = 'admin' OR citefi_rls.is_platform_admin()));

-- notifications (tenant-direct with per-user narrowing): user-targeted rows
-- (user_id NOT NULL) visible only to that user; team-wide rows (user_id NULL)
-- visible to the whole team. client_viewer denied.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_notifications_sel ON "notifications";
DROP POLICY IF EXISTS rls_notifications_ins ON "notifications";
DROP POLICY IF EXISTS rls_notifications_upd ON "notifications";
DROP POLICY IF EXISTS rls_notifications_del ON "notifications";
CREATE POLICY rls_notifications_sel ON "notifications" FOR SELECT TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer()
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  );
CREATE POLICY rls_notifications_ins ON "notifications" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_notifications_upd ON "notifications" FOR UPDATE TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer()
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  )
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_notifications_del ON "notifications" FOR DELETE TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer()
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  );

-- daily_brief_preferences (tenant-direct with per-user narrowing).
ALTER TABLE "daily_brief_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_brief_preferences" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_daily_brief_preferences_sel ON "daily_brief_preferences";
DROP POLICY IF EXISTS rls_daily_brief_preferences_ins ON "daily_brief_preferences";
DROP POLICY IF EXISTS rls_daily_brief_preferences_upd ON "daily_brief_preferences";
DROP POLICY IF EXISTS rls_daily_brief_preferences_del ON "daily_brief_preferences";
CREATE POLICY rls_daily_brief_preferences_sel ON "daily_brief_preferences" FOR SELECT TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id)
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  );
CREATE POLICY rls_daily_brief_preferences_ins ON "daily_brief_preferences" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_daily_brief_preferences_upd ON "daily_brief_preferences" FOR UPDATE TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id)
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  )
  WITH CHECK (citefi_rls.tenant_can_access(team_id));
CREATE POLICY rls_daily_brief_preferences_del ON "daily_brief_preferences" FOR DELETE TO citefi_tenant
  USING (
    citefi_rls.tenant_can_access(team_id)
    AND (user_id IS NULL OR user_id = citefi_rls.current_user_id() OR citefi_rls.actor_type() = 'worker')
  );

-- articles (tenant-direct + client_viewer approval): owner-team full access;
-- client_viewer restricted to SELECT + approval UPDATE where approval_team_id
-- matches the current team.
ALTER TABLE "articles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "articles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_articles_owner_sel ON "articles";
DROP POLICY IF EXISTS rls_articles_owner_ins ON "articles";
DROP POLICY IF EXISTS rls_articles_owner_upd ON "articles";
DROP POLICY IF EXISTS rls_articles_owner_del ON "articles";
DROP POLICY IF EXISTS rls_articles_viewer_sel ON "articles";
DROP POLICY IF EXISTS rls_articles_viewer_upd ON "articles";
-- Owner team (admin/member/worker): full access, but NOT client_viewer.
CREATE POLICY rls_articles_owner_sel ON "articles" FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_articles_owner_ins ON "articles" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_articles_owner_upd ON "articles" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY rls_articles_owner_del ON "articles" FOR DELETE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
-- client_viewer: only articles explicitly assigned to their team for review.
CREATE POLICY rls_articles_viewer_sel ON "articles" FOR SELECT TO citefi_tenant
  USING (citefi_rls.client_viewer_membership_valid(approval_team_id));
CREATE POLICY rls_articles_viewer_upd ON "articles" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.client_viewer_membership_valid(approval_team_id))
  WITH CHECK (citefi_rls.client_viewer_membership_valid(approval_team_id));

-- credit_menu_overrides (tenant-direct + global override; sensitive/billing):
-- tenant may READ its own team row and any team_id IS NULL global override.
-- Writes reserved to system / platform_admin. client_viewer denied.
ALTER TABLE "credit_menu_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_menu_overrides" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_credit_menu_overrides_sel ON "credit_menu_overrides";
DROP POLICY IF EXISTS rls_credit_menu_overrides_ins ON "credit_menu_overrides";
DROP POLICY IF EXISTS rls_credit_menu_overrides_upd ON "credit_menu_overrides";
DROP POLICY IF EXISTS rls_credit_menu_overrides_del ON "credit_menu_overrides";
CREATE POLICY rls_credit_menu_overrides_sel ON "credit_menu_overrides" FOR SELECT TO citefi_tenant
  USING (
    NOT citefi_rls.is_client_viewer()
    AND (
      team_id IS NULL
      OR citefi_rls.tenant_can_access(team_id)
    )
  );
CREATE POLICY rls_credit_menu_overrides_ins ON "credit_menu_overrides" FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.is_platform_admin() AND (team_id IS NULL OR citefi_rls.tenant_can_access(team_id)));
CREATE POLICY rls_credit_menu_overrides_upd ON "credit_menu_overrides" FOR UPDATE TO citefi_tenant
  USING (citefi_rls.is_platform_admin())
  WITH CHECK (citefi_rls.is_platform_admin());
CREATE POLICY rls_credit_menu_overrides_del ON "credit_menu_overrides" FOR DELETE TO citefi_tenant
  USING (citefi_rls.is_platform_admin());


COMMIT;

-- ============================================================================
-- End of migration 0014_tenant_rls.sql
-- ============================================================================
