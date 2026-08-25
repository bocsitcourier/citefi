-- Task #154: agency-owned, client-safe period reports.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='citefi_tenant')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='citefi_rls') THEN
    RAISE EXCEPTION 'agency reports require tenant RLS migration 0014';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agency_report_configs (
  id serial PRIMARY KEY,
  agency_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  display_name varchar(255) NOT NULL, logo_url text, accent_color varchar(20),
  recipients_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  cadence varchar(20) NOT NULL DEFAULT 'manual',
  client_visible_sections_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  markup_basis_points integer NOT NULL DEFAULT 0,
  approval_status varchar(20) NOT NULL DEFAULT 'draft',
  approved_by integer REFERENCES users(id), approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(agency_team_id,client_team_id),
  CHECK (cadence IN ('monthly','manual')),
  CHECK (markup_basis_points BETWEEN 0 AND 100000),
  CHECK (approval_status IN ('draft','approved')),
  CHECK ((approval_status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR approval_status='draft')
);

CREATE TABLE IF NOT EXISTS agency_client_reports (
  id bigserial PRIMARY KEY,
  agency_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  generated_by integer NOT NULL REFERENCES users(id),
  period_start timestamp NOT NULL, period_end timestamp NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft',
  client_safe_snapshot jsonb NOT NULL,
  snapshot_sha256 varchar(64) NOT NULL,
  approved_by integer REFERENCES users(id), approved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(agency_team_id,client_team_id,period_start,period_end),
  CONSTRAINT agency_client_reports_id_agency_client_unique UNIQUE(id,agency_team_id,client_team_id),
  CONSTRAINT agency_client_reports_period_valid CHECK (period_end > period_start),
  CONSTRAINT agency_client_reports_status_valid CHECK (status IN ('draft','approved','sent','failed')),
  CONSTRAINT agency_client_reports_sha_valid CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT agency_client_reports_approval_valid CHECK ((status IN ('approved','sent') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR status IN ('draft','failed'))
);

CREATE TABLE IF NOT EXISTS agency_report_financial_snapshots (
  report_id bigint PRIMARY KEY,
  agency_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rebilling_snapshot jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT agency_report_financial_snapshots_report_pair_fk
    FOREIGN KEY(report_id,agency_team_id,client_team_id)
    REFERENCES agency_client_reports(id,agency_team_id,client_team_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agency_report_financial_snapshots_agency_client_idx
  ON agency_report_financial_snapshots(agency_team_id,client_team_id);

-- Upgrade databases that previously applied the first Task 154 migration.
-- Dynamic SQL keeps this block valid on clean installs where the old column
-- never exists. The insert and drop are in this transaction, so no snapshot
-- can be lost between them. Re-running the migration is a no-op.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='agency_client_reports'
       AND column_name='agency_rebilling_snapshot'
  ) THEN
    EXECUTE $copy$
      INSERT INTO agency_report_financial_snapshots
        (report_id,agency_team_id,client_team_id,rebilling_snapshot,created_at)
      SELECT id,agency_team_id,client_team_id,agency_rebilling_snapshot,created_at
        FROM agency_client_reports
      ON CONFLICT (report_id) DO NOTHING
    $copy$;
    EXECUTE 'ALTER TABLE agency_client_reports DROP COLUMN agency_rebilling_snapshot';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agency_report_deliveries (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL,
  agency_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  client_team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  channel varchar(30) NOT NULL, recipient varchar(320) NOT NULL,
  status varchar(20) NOT NULL, error text, idempotency_key varchar(255) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(report_id,idempotency_key),
  FOREIGN KEY(report_id,agency_team_id,client_team_id)
    REFERENCES agency_client_reports(id,agency_team_id,client_team_id) ON DELETE CASCADE,
  CHECK (channel IN ('email','download','portal')),
  CHECK (status IN ('pending','sent','delivered','failed')),
  CHECK ((status='failed' AND error IS NOT NULL) OR status<>'failed')
);
CREATE INDEX IF NOT EXISTS agency_report_configs_client_idx ON agency_report_configs(client_team_id);
CREATE INDEX IF NOT EXISTS agency_client_reports_client_status_idx ON agency_client_reports(client_team_id,status);
CREATE INDEX IF NOT EXISTS agency_report_deliveries_report_idx ON agency_report_deliveries(report_id,created_at);

-- db:push may have created these tables before this migration. Retrofit every
-- relational/check invariant that declarative schema cannot fully represent.
CREATE UNIQUE INDEX IF NOT EXISTS agency_client_reports_id_agency_client_unique
  ON agency_client_reports(id,agency_team_id,client_team_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_configs_cadence_valid') THEN
    ALTER TABLE agency_report_configs ADD CONSTRAINT agency_report_configs_cadence_valid
      CHECK (cadence IN ('monthly','manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_configs_markup_valid') THEN
    ALTER TABLE agency_report_configs ADD CONSTRAINT agency_report_configs_markup_valid
      CHECK (markup_basis_points BETWEEN 0 AND 100000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_configs_approval_valid') THEN
    ALTER TABLE agency_report_configs ADD CONSTRAINT agency_report_configs_approval_valid
      CHECK (approval_status IN ('draft','approved')
        AND ((approval_status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
          OR approval_status='draft'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_client_reports_period_valid') THEN
    ALTER TABLE agency_client_reports ADD CONSTRAINT agency_client_reports_period_valid
      CHECK (period_end > period_start);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_client_reports_status_valid') THEN
    ALTER TABLE agency_client_reports ADD CONSTRAINT agency_client_reports_status_valid
      CHECK (status IN ('draft','approved','sent','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_client_reports_sha_valid') THEN
    ALTER TABLE agency_client_reports ADD CONSTRAINT agency_client_reports_sha_valid
      CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_client_reports_approval_valid') THEN
    ALTER TABLE agency_client_reports ADD CONSTRAINT agency_client_reports_approval_valid
      CHECK ((status IN ('approved','sent') AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
        OR status IN ('draft','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_financial_snapshots_report_pair_fk') THEN
    ALTER TABLE agency_report_financial_snapshots
      ADD CONSTRAINT agency_report_financial_snapshots_report_pair_fk
      FOREIGN KEY(report_id,agency_team_id,client_team_id)
      REFERENCES agency_client_reports(id,agency_team_id,client_team_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_deliveries_report_pair_fk') THEN
    ALTER TABLE agency_report_deliveries
      ADD CONSTRAINT agency_report_deliveries_report_pair_fk
      FOREIGN KEY(report_id,agency_team_id,client_team_id)
      REFERENCES agency_client_reports(id,agency_team_id,client_team_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_deliveries_channel_valid') THEN
    ALTER TABLE agency_report_deliveries ADD CONSTRAINT agency_report_deliveries_channel_valid
      CHECK (channel IN ('email','download','portal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_deliveries_status_valid') THEN
    ALTER TABLE agency_report_deliveries ADD CONSTRAINT agency_report_deliveries_status_valid
      CHECK (status IN ('pending','sent','delivered','failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agency_report_deliveries_error_valid') THEN
    ALTER TABLE agency_report_deliveries ADD CONSTRAINT agency_report_deliveries_error_valid
      CHECK ((status='failed' AND error IS NOT NULL) OR status<>'failed');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION citefi_rls.agency_report_pair_valid(agency integer, client integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET row_security=off
SET search_path=citefi_rls,pg_catalog,public AS $$
 SELECT EXISTS (SELECT 1 FROM teams a JOIN teams c ON c.parent_team_id=a.id
   WHERE a.id=agency AND c.id=client AND a.deleted_at IS NULL AND c.deleted_at IS NULL
     AND c.client_status='active' AND a.billing_plan='agency')
$$;
CREATE OR REPLACE FUNCTION citefi_rls.agency_report_admin(agency integer, client integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET row_security=off
SET search_path=citefi_rls,pg_catalog,public AS $$
 SELECT citefi_rls.actor_type()='web'
   AND citefi_rls.current_team_id()=agency
   AND citefi_rls.member_role() IN ('owner','admin','platform_admin')
   AND citefi_rls.web_membership_valid(agency)
   AND citefi_rls.agency_report_pair_valid(agency,client)
$$;
CREATE OR REPLACE FUNCTION citefi_rls.agency_report_period_evidence(
  agency integer, client integer, period_start timestamp, period_end timestamp
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET row_security=off
SET search_path=citefi_rls,pg_catalog,public AS $$
DECLARE evidence jsonb;
BEGIN
  IF period_end <= period_start THEN
    RAISE EXCEPTION 'periodEnd must be after periodStart' USING ERRCODE='22007';
  END IF;
  IF NOT citefi_rls.agency_report_admin(agency,client) THEN
    RAISE EXCEPTION 'agency report evidence access denied' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_build_object(
    'period', jsonb_build_object('start', to_jsonb(period_start), 'end', to_jsonb(period_end)),
    'campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'count',q.count) ORDER BY q.status)
      FROM (SELECT status,count(*)::int AS count FROM campaigns
            WHERE team_id=client AND created_at>=period_start AND created_at<period_end GROUP BY status) q
    ), '[]'::jsonb),
    'articles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'approval',q.approval,'count',q.count)
                       ORDER BY q.status,q.approval)
      FROM (SELECT article_status AS status,approval_status AS approval,count(*)::int AS count
            FROM articles WHERE team_id=client AND created_at>=period_start AND created_at<period_end
              AND deleted_at IS NULL GROUP BY article_status,approval_status) q
    ), '[]'::jsonb),
    'socialAssets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'count',q.count) ORDER BY q.status)
      FROM (SELECT status,count(*)::int AS count FROM social_posts
            WHERE team_id=client AND created_at>=period_start AND created_at<period_end GROUP BY status) q
    ), '[]'::jsonb),
    'videoAssets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'count',q.count) ORDER BY q.status)
      FROM (SELECT status,count(*)::int AS count FROM video_ideas
            WHERE team_id=client AND created_at>=period_start AND created_at<period_end GROUP BY status) q
    ), '[]'::jsonb),
    'publishing', CASE WHEN EXISTS (
      SELECT 1 FROM publishing_connections WHERE team_id=client AND status='active' AND deleted_at IS NULL
    ) THEN jsonb_build_object('available',true,'statuses',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'count',q.count) ORDER BY q.status)
      FROM (SELECT status,count(*)::int AS count FROM publishing_jobs
            WHERE team_id=client AND created_at>=period_start AND created_at<period_end GROUP BY status) q
    ),'[]'::jsonb))
    ELSE jsonb_build_object('available',false,'reason','Publishing is not connected for this client') END,
    'exports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('status',q.status,'count',q.count) ORDER BY q.status)
      FROM (SELECT status,count(*)::int AS count FROM campaign_exports
            WHERE team_id=client AND created_at>=period_start AND created_at<period_end GROUP BY status) q
    ), '[]'::jsonb),
    'performance', CASE WHEN EXISTS (
      SELECT 1 FROM content_performance_metrics
       WHERE team_id=client AND created_at>=period_start AND created_at<period_end
    ) THEN (
      SELECT jsonb_build_object('available',true,'samples',count(*)::int,
        'views',coalesce(sum(views),0)::bigint,'clicks',coalesce(sum(clicks),0)::bigint,
        'shares',coalesce(sum(shares),0)::bigint,'likes',coalesce(sum(likes),0)::bigint,
        'comments',coalesce(sum(comments),0)::bigint)
      FROM content_performance_metrics
       WHERE team_id=client AND created_at>=period_start AND created_at<period_end
    ) ELSE jsonb_build_object('available',false,'reason','No content performance metrics recorded for this period') END,
    'dailyBriefThemes', CASE WHEN EXISTS (
      SELECT 1 FROM daily_briefs WHERE team_id=client AND created_at>=period_start
        AND created_at<period_end AND status='generated'
    ) THEN jsonb_build_object('available',true,'themes',(
      SELECT jsonb_agg(jsonb_build_object('localDate',local_date,'focus',today_focus_type) ORDER BY local_date)
      FROM daily_briefs WHERE team_id=client AND created_at>=period_start
        AND created_at<period_end AND status='generated'
    )) ELSE jsonb_build_object('available',false,'reason','No Daily Brief themes were recorded for this period') END,
    'recommendations', CASE WHEN EXISTS (
      SELECT 1 FROM daily_briefs WHERE team_id=client AND created_at>=period_start
        AND created_at<period_end AND status='generated'
        AND jsonb_typeof(sections_json->'todayFocus'->'action')='string'
    ) THEN jsonb_build_object('available',true,'items',(
      SELECT jsonb_agg(jsonb_build_object('localDate',local_date,
        'action',sections_json->'todayFocus'->>'action',
        'why',sections_json->'todayFocus'->>'why') ORDER BY local_date)
      FROM daily_briefs WHERE team_id=client AND created_at>=period_start
        AND created_at<period_end AND status='generated'
        AND jsonb_typeof(sections_json->'todayFocus'->'action')='string'
    )) ELSE jsonb_build_object('available',false,'reason','No evidence-backed recommendations were recorded for this period') END,
    'accounting', jsonb_build_object(
      'providerCostMicrousd', COALESCE((SELECT sum(cost_microusd)::bigint FROM provider_usage_ledger
        WHERE team_id=client AND occurred_at>=period_start AND occurred_at<period_end),0),
      'providerLedgerEvents', (SELECT count(*)::int FROM provider_usage_ledger
        WHERE team_id=client AND occurred_at>=period_start AND occurred_at<period_end),
      'creditDebits', COALESCE((SELECT sum(abs(amount))::bigint FROM credit_ledger
        WHERE team_id=client AND event_type='debit' AND created_at>=period_start AND created_at<period_end),0),
      'creditDebitEvents', (SELECT count(*)::int FROM credit_ledger
        WHERE team_id=client AND event_type='debit' AND created_at>=period_start AND created_at<period_end)
    )
  ) INTO evidence;
  RETURN evidence;
END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_agency_report_pair()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET row_security=off
SET search_path=citefi_rls,pg_catalog,public AS $$
BEGIN
 IF NOT citefi_rls.agency_report_pair_valid(NEW.agency_team_id,NEW.client_team_id) THEN
   RAISE EXCEPTION 'report client must be an active direct child of an agency plan' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_agency_report_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.agency_team_id IS DISTINCT FROM OLD.agency_team_id
 OR NEW.client_team_id IS DISTINCT FROM OLD.client_team_id
 OR NEW.generated_by IS DISTINCT FROM OLD.generated_by
 OR NEW.period_start IS DISTINCT FROM OLD.period_start
 OR NEW.period_end IS DISTINCT FROM OLD.period_end
 OR NEW.client_safe_snapshot IS DISTINCT FROM OLD.client_safe_snapshot
 OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256 THEN
   RAISE EXCEPTION 'agency report snapshots are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_agency_report_financial_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'agency report financial snapshots are immutable';
END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_agency_report_delivery()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'agency report deliveries are append-only'; END $$;

DROP TRIGGER IF EXISTS agency_report_config_pair ON agency_report_configs;
DROP TRIGGER IF EXISTS agency_client_report_pair ON agency_client_reports;
DROP TRIGGER IF EXISTS agency_client_report_snapshot_immutable ON agency_client_reports;
DROP TRIGGER IF EXISTS agency_report_financial_pair ON agency_report_financial_snapshots;
DROP TRIGGER IF EXISTS agency_report_financial_snapshot_immutable ON agency_report_financial_snapshots;
DROP TRIGGER IF EXISTS agency_report_deliveries_append_only ON agency_report_deliveries;
CREATE TRIGGER agency_report_config_pair BEFORE INSERT OR UPDATE ON agency_report_configs FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_pair();
CREATE TRIGGER agency_client_report_pair BEFORE INSERT OR UPDATE ON agency_client_reports FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_pair();
CREATE TRIGGER agency_client_report_snapshot_immutable BEFORE UPDATE ON agency_client_reports FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_snapshot();
CREATE TRIGGER agency_report_financial_pair BEFORE INSERT ON agency_report_financial_snapshots FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_pair();
CREATE TRIGGER agency_report_financial_snapshot_immutable BEFORE UPDATE OR DELETE ON agency_report_financial_snapshots FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_financial_snapshot();
CREATE TRIGGER agency_report_deliveries_append_only BEFORE UPDATE OR DELETE ON agency_report_deliveries FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_agency_report_delivery();

GRANT SELECT,INSERT,UPDATE,DELETE ON agency_report_configs TO citefi_tenant;
GRANT SELECT,INSERT,UPDATE ON agency_client_reports TO citefi_tenant;
REVOKE ALL ON agency_report_financial_snapshots FROM PUBLIC;
REVOKE ALL ON agency_report_financial_snapshots FROM citefi_tenant;
GRANT SELECT,INSERT ON agency_report_financial_snapshots TO citefi_tenant;
GRANT SELECT,INSERT ON agency_report_deliveries TO citefi_tenant;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO citefi_tenant;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA citefi_rls FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA citefi_rls TO citefi_tenant;

ALTER TABLE agency_report_configs ENABLE ROW LEVEL SECURITY; ALTER TABLE agency_report_configs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_report_configs_admin ON agency_report_configs;
CREATE POLICY agency_report_configs_admin ON agency_report_configs TO citefi_tenant
 USING (citefi_rls.agency_report_admin(agency_team_id,client_team_id))
 WITH CHECK (citefi_rls.agency_report_admin(agency_team_id,client_team_id));

ALTER TABLE agency_client_reports ENABLE ROW LEVEL SECURITY; ALTER TABLE agency_client_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_client_reports_select ON agency_client_reports;
DROP POLICY IF EXISTS agency_client_reports_insert ON agency_client_reports;
DROP POLICY IF EXISTS agency_client_reports_update ON agency_client_reports;
CREATE POLICY agency_client_reports_select ON agency_client_reports FOR SELECT TO citefi_tenant USING (
 citefi_rls.agency_report_admin(agency_team_id,client_team_id)
 OR (client_team_id=citefi_rls.current_team_id() AND status IN ('approved','sent')
   AND (citefi_rls.web_membership_valid(client_team_id)
     OR citefi_rls.client_viewer_membership_valid(client_team_id)))
);
CREATE POLICY agency_client_reports_insert ON agency_client_reports FOR INSERT TO citefi_tenant
 WITH CHECK (citefi_rls.agency_report_admin(agency_team_id,client_team_id));
CREATE POLICY agency_client_reports_update ON agency_client_reports FOR UPDATE TO citefi_tenant
 USING (citefi_rls.agency_report_admin(agency_team_id,client_team_id))
 WITH CHECK (citefi_rls.agency_report_admin(agency_team_id,client_team_id));

ALTER TABLE agency_report_financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_report_financial_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_report_financial_snapshots_admin ON agency_report_financial_snapshots;
CREATE POLICY agency_report_financial_snapshots_admin ON agency_report_financial_snapshots TO citefi_tenant
 USING (citefi_rls.agency_report_admin(agency_team_id,client_team_id))
 WITH CHECK (citefi_rls.agency_report_admin(agency_team_id,client_team_id));

ALTER TABLE agency_report_deliveries ENABLE ROW LEVEL SECURITY; ALTER TABLE agency_report_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agency_report_deliveries_admin ON agency_report_deliveries;
CREATE POLICY agency_report_deliveries_admin ON agency_report_deliveries TO citefi_tenant
 USING (citefi_rls.agency_report_admin(agency_team_id,client_team_id))
 WITH CHECK (citefi_rls.agency_report_admin(agency_team_id,client_team_id));

-- Evidence aggregation is exposed only through the constrained SECURITY
-- DEFINER function above; agencies never receive raw credit-ledger access.
DROP POLICY IF EXISTS agency_report_credit_ledger_select ON credit_ledger;
COMMIT;