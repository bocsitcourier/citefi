-- Task #153: immutable provider COGS ledger and locked rate card.
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'citefi_rls') THEN
    RAISE EXCEPTION 'provider usage ledger requires tenant RLS migration 0014';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS provider_rate_versions (
  id serial PRIMARY KEY, version varchar(80) NOT NULL UNIQUE,
  evidence_url text NOT NULL, source_note text NOT NULL,
  effective_from timestamp NOT NULL, effective_to timestamp,
  locked_at timestamp NOT NULL DEFAULT now(), created_at timestamp NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE IF NOT EXISTS provider_rates (
  id serial PRIMARY KEY, rate_version_id integer NOT NULL REFERENCES provider_rate_versions(id),
  provider varchar(40) NOT NULL, model varchar(120) NOT NULL, unit_type varchar(30) NOT NULL,
  input_microusd_per_million bigint, output_microusd_per_million bigint, microusd_per_unit bigint,
  effective_from timestamp NOT NULL, effective_to timestamp, evidence_url text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((unit_type = 'tokens' AND input_microusd_per_million IS NOT NULL AND output_microusd_per_million IS NOT NULL)
      OR (unit_type <> 'tokens' AND microusd_per_unit IS NOT NULL)),
  UNIQUE(rate_version_id, provider, model, unit_type)
);
CREATE TABLE IF NOT EXISTS provider_usage_ledger (
  id bigserial PRIMARY KEY, source_event_id varchar(255) NOT NULL UNIQUE,
  team_id integer NOT NULL REFERENCES teams(id), agency_team_id integer REFERENCES teams(id),
  event_type varchar(20) NOT NULL, original_event_id bigint REFERENCES provider_usage_ledger(id),
  campaign_id integer, run_id varchar(100), job_id varchar(100), content_id integer,
  resource_type varchar(50), resource_id varchar(100), operation_type varchar(80) NOT NULL,
  provider varchar(40) NOT NULL, model varchar(120) NOT NULL, unit_type varchar(30) NOT NULL,
  input_units integer, output_units integer, unit_count integer NOT NULL DEFAULT 0,
  cost_microusd bigint NOT NULL, rate_version_id integer REFERENCES provider_rate_versions(id),
  provider_rate_id integer REFERENCES provider_rates(id), rate_snapshot jsonb NOT NULL,
  provider_request_id varchar(255), provider_metadata jsonb,
  occurred_at timestamp NOT NULL, recorded_at timestamp NOT NULL DEFAULT now(),
  CHECK (event_type IN ('usage','correction','refund')),
  CHECK ((event_type = 'usage' AND cost_microusd >= 0 AND original_event_id IS NULL)
      OR (event_type IN ('correction','refund') AND cost_microusd <> 0 AND original_event_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS provider_invoice_reconciliations (
  id serial PRIMARY KEY, provider varchar(40) NOT NULL, invoice_reference varchar(255) NOT NULL,
  period_start timestamp NOT NULL, period_end timestamp NOT NULL,
  invoiced_cost_microusd bigint NOT NULL, ledger_cost_microusd bigint NOT NULL,
  variance_microusd bigint NOT NULL, evidence_url text, metadata jsonb,
  recorded_at timestamp NOT NULL DEFAULT now(),
  CHECK (period_end > period_start), UNIQUE(provider, invoice_reference)
);
CREATE INDEX IF NOT EXISTS provider_rates_lookup_idx ON provider_rates(provider,model,unit_type,effective_from);
CREATE INDEX IF NOT EXISTS provider_usage_ledger_team_occurred_idx ON provider_usage_ledger(team_id,occurred_at);
CREATE INDEX IF NOT EXISTS provider_usage_ledger_provider_occurred_idx ON provider_usage_ledger(provider,occurred_at);
CREATE INDEX IF NOT EXISTS provider_usage_ledger_original_idx ON provider_usage_ledger(original_event_id);
CREATE INDEX IF NOT EXISTS provider_invoice_reconciliation_period_idx ON provider_invoice_reconciliations(provider,period_start,period_end);

-- Rates are copied exactly from lib/cost-telemetry.ts; amounts are microUSD.
INSERT INTO provider_rate_versions(version,evidence_url,source_note,effective_from)
VALUES ('2026-08-22','https://ai.google.dev/gemini-api/docs/pricing','Locked provider-specific rates; each row carries its own evidence URL','2026-08-22')
ON CONFLICT (version) DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,input_microusd_per_million,output_microusd_per_million,effective_from,evidence_url)
SELECT v.id, x.provider, x.model, 'tokens', x.input_rate, x.output_rate, '2026-08-22',
       'https://ai.google.dev/gemini-api/docs/pricing'
FROM provider_rate_versions v
CROSS JOIN (VALUES
 ('gemini','gemini-3.6-flash',300000,2500000),('gemini','gemini-3.5-flash',300000,2500000),('gemini','gemini-3.5-flash-lite',100000,400000),
 ('gemini','gemini-3.1-pro-preview',1250000,10000000),('gemini','gemini-3.1-flash-lite',100000,400000),('gemini','gemini-3-flash-preview',300000,2500000),
 ('gemini','gemini-3.1-flash-image',300000,2500000),('gemini','gemini-3.1-flash-lite-image',100000,400000),('gemini','gemini-3-pro-image',1250000,10000000),
 ('gemini','gemini-2.5-flash-image',300000,2500000),('gemini','gemini-2.5-flash',300000,2500000),('gemini','gemini-2.5-flash-preview',150000,3500000),
 ('gemini','gemini-2.5-flash-preview-04-17',150000,3500000),('gemini','gemini-2.5-flash-lite',100000,400000),('gemini','gemini-2.5-pro',1250000,10000000),
 ('openai','gpt-4.1-mini',400000,1600000),('openai','gpt-4.1-mini-2025-04-14',400000,1600000),('openai','gpt-4.1',2000000,8000000),
 ('openai','gpt-4.1-2025-04-14',2000000,8000000),('openai','gpt-4o-mini',150000,600000),('openai','gpt-4o-mini-tts',0,0),
 ('openai','gpt-4o',5000000,15000000),('openai','chatgpt-4o-latest',5000000,15000000),('openai','gpt-4',30000000,60000000),('openai','gpt-4-turbo',10000000,30000000)
) AS x(provider,model,input_rate,output_rate)
WHERE v.version='2026-08-22' ON CONFLICT DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,microusd_per_unit,effective_from,evidence_url)
SELECT v.id,'gemini',x.model,'seconds',x.rate,'2026-08-22','https://ai.google.dev/gemini-api/docs/pricing'
FROM provider_rate_versions v CROSS JOIN (VALUES ('veo-3.1-generate-preview',350000),('veo-3.1-fast-generate-preview',180000),('veo-3.1-lite-generate-preview',90000)) x(model,rate)
WHERE v.version='2026-08-22' ON CONFLICT DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,microusd_per_unit,effective_from,evidence_url)
SELECT id,'openai','gpt-4o-mini-tts','characters',15,'2026-08-22','https://platform.openai.com/docs/pricing'
FROM provider_rate_versions WHERE version='2026-08-22' ON CONFLICT DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,microusd_per_unit,effective_from,evidence_url)
SELECT v.id,'gemini',x.model,'images',40000,'2026-08-22','https://ai.google.dev/gemini-api/docs/pricing'
FROM provider_rate_versions v CROSS JOIN (VALUES
 ('gemini-3.1-flash-image'),('gemini-3.1-flash-lite-image'),('gemini-3-pro-image'),('gemini-2.5-flash-image')
) x(model)
WHERE v.version='2026-08-22' ON CONFLICT DO NOTHING;
INSERT INTO provider_rates(rate_version_id,provider,model,unit_type,microusd_per_unit,effective_from,evidence_url)
SELECT id,'brave','web-search','requests',5000,'2026-08-22','https://api-dashboard.search.brave.com/documentation/pricing'
FROM provider_rate_versions WHERE version='2026-08-22' ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION citefi_rls.provider_ledger_select_allowed(row_team integer) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET row_security = off
SET search_path = citefi_rls, pg_catalog, public AS $$
BEGIN
  IF citefi_rls.is_client_viewer() THEN RETURN false; END IF;
  IF citefi_rls.tenant_can_access(row_team) THEN RETURN true; END IF;
  RETURN citefi_rls.actor_type() = 'web'
    AND citefi_rls.member_role() IN ('owner','admin')
    AND EXISTS (SELECT 1 FROM teams child WHERE child.id=row_team AND child.parent_team_id=citefi_rls.current_team_id())
    AND citefi_rls.web_membership_valid(citefi_rls.current_team_id());
END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_provider_usage_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'provider usage ledger is append-only'; END $$;
CREATE OR REPLACE FUNCTION citefi_rls.guard_provider_rate_immutability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'provider rates are immutable'; END $$;
CREATE TRIGGER provider_usage_ledger_append_only BEFORE UPDATE OR DELETE ON provider_usage_ledger
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_provider_usage_ledger();
CREATE TRIGGER provider_rate_versions_immutable BEFORE UPDATE OR DELETE ON provider_rate_versions
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_provider_rate_immutability();
CREATE TRIGGER provider_rates_immutable BEFORE UPDATE OR DELETE ON provider_rates
FOR EACH ROW EXECUTE FUNCTION citefi_rls.guard_provider_rate_immutability();

GRANT SELECT,INSERT ON provider_usage_ledger TO citefi_tenant;
GRANT SELECT ON provider_rate_versions,provider_rates TO citefi_tenant;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO citefi_tenant;
ALTER TABLE provider_usage_ledger ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_usage_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_usage_ledger_select ON provider_usage_ledger FOR SELECT TO citefi_tenant USING (citefi_rls.provider_ledger_select_allowed(team_id));
CREATE POLICY provider_usage_ledger_insert ON provider_usage_ledger FOR INSERT TO citefi_tenant WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
ALTER TABLE provider_rate_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_rate_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_rate_versions_select ON provider_rate_versions FOR SELECT TO citefi_tenant USING (NOT citefi_rls.is_client_viewer());
ALTER TABLE provider_rates ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY provider_rates_select ON provider_rates FOR SELECT TO citefi_tenant USING (NOT citefi_rls.is_client_viewer());
-- Invoice records are platform reconciliation evidence, not tenant data.
-- No citefi_tenant grant/policy is deliberate; systemDb retains platform access.
ALTER TABLE provider_invoice_reconciliations ENABLE ROW LEVEL SECURITY; ALTER TABLE provider_invoice_reconciliations FORCE ROW LEVEL SECURITY;
COMMIT;