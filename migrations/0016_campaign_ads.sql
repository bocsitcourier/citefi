-- Task #152: export-only Ads Lab. Requires migrations 0014 and 0015.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='citefi_rls' AND p.proname='tenant_can_access') THEN
    RAISE EXCEPTION 'Ads Lab migration requires tenant RLS migration 0014';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS campaign_ads (
  id serial PRIMARY KEY, public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id integer NOT NULL, created_by integer NOT NULL REFERENCES users(id),
  request_key varchar(255) NOT NULL, status varchar(30) NOT NULL DEFAULT 'draft',
  landing_url text NOT NULL, campaign_slug varchar(255) NOT NULL,
  google_assets jsonb NOT NULL, meta_assets jsonb NOT NULL,
  validation_json jsonb NOT NULL, policy_json jsonb NOT NULL,
  generation_model varchar(100) NOT NULL, brand_snapshot jsonb NOT NULL,
  manifest_json jsonb, manifest_sha256 varchar(64), finalized_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT campaign_ads_campaign_team_fk FOREIGN KEY(team_id,campaign_id)
    REFERENCES campaigns(team_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ads_public_id_key ON campaign_ads(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ads_team_request_key_unique ON campaign_ads(team_id,request_key);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ads_team_id_id_unique ON campaign_ads(team_id,id);
CREATE INDEX IF NOT EXISTS campaign_ads_public_id_idx ON campaign_ads(public_id);
CREATE INDEX IF NOT EXISTS campaign_ads_campaign_id_idx ON campaign_ads(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_ads_team_status_idx ON campaign_ads(team_id,status);

CREATE TABLE IF NOT EXISTS campaign_ad_approvals (
  id serial PRIMARY KEY, public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_ad_id integer NOT NULL, actor_user_id integer NOT NULL REFERENCES users(id),
  approval_type varchar(30) NOT NULL, decision varchar(20) NOT NULL,
  human_acknowledged boolean NOT NULL DEFAULT false,
  acknowledgement_text text, metadata_json jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT campaign_ad_approvals_ad_team_fk FOREIGN KEY(team_id,campaign_ad_id)
    REFERENCES campaign_ads(team_id,id) ON DELETE CASCADE,
  CONSTRAINT campaign_ad_approvals_type_check CHECK (approval_type IN ('client','policy','export')),
  CONSTRAINT campaign_ad_approvals_decision_check CHECK (decision IN ('approved','rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_ad_approvals_public_id_key ON campaign_ad_approvals(public_id);
CREATE INDEX IF NOT EXISTS campaign_ad_approvals_public_id_idx ON campaign_ad_approvals(public_id);
CREATE INDEX IF NOT EXISTS campaign_ad_approvals_ad_id_idx ON campaign_ad_approvals(campaign_ad_id);
CREATE INDEX IF NOT EXISTS campaign_ad_approvals_team_type_idx ON campaign_ad_approvals(team_id,approval_type);

-- Final manifests and the campaign's confirmed brand snapshot are immutable.
CREATE OR REPLACE FUNCTION citefi_rls.guard_ads_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'finalized ad export records are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_ads_immutable ON campaign_ads;
CREATE TRIGGER campaign_ads_immutable BEFORE UPDATE ON campaign_ads
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_ads_immutability();

CREATE OR REPLACE FUNCTION citefi_rls.guard_confirmed_campaign_brand() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.brand_confirmed_at IS NOT NULL AND NEW.brand_profile_snapshot IS DISTINCT FROM OLD.brand_profile_snapshot THEN
    RAISE EXCEPTION 'confirmed campaign brand snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaigns_brand_snapshot_immutable ON campaigns;
CREATE TRIGGER campaigns_brand_snapshot_immutable BEFORE UPDATE ON campaigns
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_confirmed_campaign_brand();

CREATE OR REPLACE FUNCTION citefi_rls.guard_ad_approval_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ad approval audit records are append-only';
END $$;
DROP TRIGGER IF EXISTS campaign_ad_approvals_append_only ON campaign_ad_approvals;
CREATE TRIGGER campaign_ad_approvals_append_only BEFORE UPDATE OR DELETE ON campaign_ad_approvals
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_ad_approval_audit();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['campaign_ads','campaign_ad_approvals'] LOOP
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO citefi_tenant',t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_sel ON %I',t,t);
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_ins ON %I',t,t);
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_upd ON %I',t,t);
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_del ON %I',t,t);
    EXECUTE format('CREATE POLICY rls_%s_sel ON %I FOR SELECT TO citefi_tenant USING (citefi_rls.tenant_can_access(team_id))',t,t);
    EXECUTE format('CREATE POLICY rls_%s_ins ON %I FOR INSERT TO citefi_tenant WITH CHECK (citefi_rls.tenant_can_access(team_id))',t,t);
    EXECUTE format('CREATE POLICY rls_%s_upd ON %I FOR UPDATE TO citefi_tenant USING (citefi_rls.tenant_can_access(team_id)) WITH CHECK (citefi_rls.tenant_can_access(team_id))',t,t);
    EXECUTE format('CREATE POLICY rls_%s_del ON %I FOR DELETE TO citefi_tenant USING (citefi_rls.tenant_can_access(team_id))',t,t);
  END LOOP;
  REVOKE UPDATE,DELETE ON campaign_ad_approvals FROM citefi_tenant;
  GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO citefi_tenant;
END $$;
COMMIT;