-- Migration 0034 — durable, non-secret provider attempt receipts (Task #179).
--
-- A receipt is prepared before a physical provider submission.  It contains
-- only bounded request/response metadata and usage; it is not a prompt,
-- content, credential, or media store.  The receipt may be updated as the
-- known provider response and immutable usage-ledger event are captured.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'citefi_tenant')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'citefi_rls') THEN
    RAISE EXCEPTION
      'provider attempt receipts require tenant RLS migration 0014';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS provider_attempt_receipts (
  id bigserial PRIMARY KEY,
  source_event_id varchar(255) NOT NULL UNIQUE,
  team_id integer NOT NULL REFERENCES teams(id),
  user_id integer REFERENCES users(id),
  campaign_id integer,
  content_id integer,
  resource_type varchar(50),
  resource_id varchar(100),
  run_id varchar(100),
  job_id varchar(100),
  operation_type varchar(80) NOT NULL,
  provider varchar(40) NOT NULL,
  model varchar(120) NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  request_metadata jsonb NOT NULL,
  provider_request_id varchar(255),
  response_usage jsonb,
  response_metadata jsonb,
  status varchar(40) NOT NULL DEFAULT 'prepared'
    CHECK (status IN (
      'prepared', 'submitted', 'usage_captured', 'accounted',
      'provider_rejected', 'uncertain', 'reconciliation_required',
      'accounting_failed'
    )),
  failure_code varchar(80),
  failure_message varchar(255),
  prepared_at timestamp NOT NULL DEFAULT now(),
  submitted_at timestamp,
  usage_captured_at timestamp,
  accounted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT provider_attempt_receipts_usage_status_check CHECK (
    status NOT IN ('usage_captured', 'accounted')
    OR response_usage IS NOT NULL
  )
);

-- A nullable campaign must belong to this same team.  MATCH SIMPLE preserves
-- legacy/unscoped receipts while preventing an explicit cross-tenant pointer.
CREATE UNIQUE INDEX IF NOT EXISTS provider_attempt_receipts_team_id_id_unique
  ON provider_attempt_receipts(team_id, id);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'provider_attempt_receipts_campaign_team_fk'
  ) THEN
    ALTER TABLE provider_attempt_receipts
      ADD CONSTRAINT provider_attempt_receipts_campaign_team_fk
      FOREIGN KEY (team_id, campaign_id)
      REFERENCES campaigns(team_id, id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS provider_attempt_receipts_team_created_idx
  ON provider_attempt_receipts(team_id, created_at);
CREATE INDEX IF NOT EXISTS provider_attempt_receipts_team_status_idx
  ON provider_attempt_receipts(team_id, status);
CREATE INDEX IF NOT EXISTS provider_attempt_receipts_provider_request_idx
  ON provider_attempt_receipts(provider, provider_request_id);
CREATE INDEX IF NOT EXISTS provider_attempt_receipts_resource_idx
  ON provider_attempt_receipts(team_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS provider_attempt_receipts_content_idx
  ON provider_attempt_receipts(team_id, content_id);

GRANT SELECT, INSERT, UPDATE ON provider_attempt_receipts TO citefi_tenant;
GRANT USAGE, SELECT ON SEQUENCE provider_attempt_receipts_id_seq TO citefi_tenant;

ALTER TABLE provider_attempt_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_attempt_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_attempt_receipts_select ON provider_attempt_receipts;
DROP POLICY IF EXISTS provider_attempt_receipts_insert ON provider_attempt_receipts;
DROP POLICY IF EXISTS provider_attempt_receipts_update ON provider_attempt_receipts;
CREATE POLICY provider_attempt_receipts_select ON provider_attempt_receipts
  FOR SELECT TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY provider_attempt_receipts_insert ON provider_attempt_receipts
  FOR INSERT TO citefi_tenant
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());
CREATE POLICY provider_attempt_receipts_update ON provider_attempt_receipts
  FOR UPDATE TO citefi_tenant
  USING (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer())
  WITH CHECK (citefi_rls.tenant_can_access(team_id) AND NOT citefi_rls.is_client_viewer());

COMMIT;