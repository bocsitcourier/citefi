-- Global append-only incident intelligence. Ordered after 0019.
-- Idempotent so interrupted releases can safely re-run it.
BEGIN;

CREATE TABLE IF NOT EXISTS telemetry_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint varchar(64) NOT NULL,
  environment varchar(50) NOT NULL,
  category varchar(80) NOT NULL,
  severity varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'open',
  title varchar(500) NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  evidence_version integer NOT NULL DEFAULT 1,
  first_seen_at timestamp NOT NULL,
  last_seen_at timestamp NOT NULL,
  acknowledged_at timestamp,
  acknowledged_by integer REFERENCES users(id),
  assignee_user_id integer REFERENCES users(id),
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT telemetry_incidents_severity_check CHECK (severity IN ('warning','error','critical')),
  CONSTRAINT telemetry_incidents_status_check CHECK (status IN ('open','acknowledged','resolved','ignored')),
  CONSTRAINT telemetry_incidents_count_check CHECK (occurrence_count > 0 AND evidence_version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_incidents_fingerprint_environment_unique
  ON telemetry_incidents(fingerprint, environment);
CREATE INDEX IF NOT EXISTS telemetry_incidents_status_severity_last_seen_idx
  ON telemetry_incidents(status, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
  event_id uuid PRIMARY KEY,
  incident_id uuid REFERENCES telemetry_incidents(id) ON DELETE SET NULL,
  occurred_at timestamp NOT NULL,
  received_at timestamp NOT NULL DEFAULT now(),
  environment varchar(50) NOT NULL, release varchar(100), process varchar(100) NOT NULL,
  severity varchar(20) NOT NULL, category varchar(80) NOT NULL,
  fingerprint varchar(64) NOT NULL, message text NOT NULL, stack text,
  request_id varchar(128), job_id varchar(128), deploy_id varchar(128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT telemetry_events_severity_check CHECK (severity IN ('warning','error','critical'))
);
CREATE INDEX IF NOT EXISTS telemetry_events_incident_occurred_idx ON telemetry_events(incident_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_correlation_idx ON telemetry_events(request_id,job_id,deploy_id);
CREATE INDEX IF NOT EXISTS telemetry_events_fingerprint_occurred_idx ON telemetry_events(fingerprint,occurred_at DESC);

-- Events are immutable after ingestion finalizes its one allowed incident link.
CREATE OR REPLACE FUNCTION telemetry_events_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'telemetry_events is append-only';
  END IF;
  IF OLD.incident_id IS NULL AND NEW.incident_id IS NOT NULL
     AND (to_jsonb(NEW) - 'incident_id') = (to_jsonb(OLD) - 'incident_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'telemetry_events is append-only';
END $$;
DROP TRIGGER IF EXISTS telemetry_events_append_only ON telemetry_events;
CREATE TRIGGER telemetry_events_append_only
  BEFORE UPDATE OR DELETE ON telemetry_events
  FOR EACH ROW EXECUTE FUNCTION telemetry_events_append_only_guard();

CREATE TABLE IF NOT EXISTS telemetry_incident_audit (
  id bigserial PRIMARY KEY, incident_id uuid NOT NULL REFERENCES telemetry_incidents(id) ON DELETE CASCADE,
  action varchar(30) NOT NULL, from_status varchar(20), to_status varchar(20),
  actor_user_id integer REFERENCES users(id), note varchar(1000), created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_incident_audit_incident_created_idx ON telemetry_incident_audit(incident_id,created_at);

CREATE OR REPLACE FUNCTION telemetry_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS telemetry_incident_audit_append_only ON telemetry_incident_audit;
CREATE TRIGGER telemetry_incident_audit_append_only BEFORE UPDATE OR DELETE ON telemetry_incident_audit
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();

CREATE TABLE IF NOT EXISTS telemetry_notification_deliveries (
  id bigserial PRIMARY KEY, incident_id uuid NOT NULL REFERENCES telemetry_incidents(id) ON DELETE CASCADE,
  admin_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_kind varchar(20) NOT NULL, evidence_version integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(incident_id,admin_user_id,notification_kind,evidence_version)
);
DROP TRIGGER IF EXISTS telemetry_notification_deliveries_append_only ON telemetry_notification_deliveries;
CREATE TRIGGER telemetry_notification_deliveries_append_only BEFORE UPDATE OR DELETE ON telemetry_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();

CREATE TABLE IF NOT EXISTS telemetry_ai_analyses (
  id bigserial PRIMARY KEY, incident_id uuid NOT NULL REFERENCES telemetry_incidents(id) ON DELETE CASCADE,
  evidence_version integer NOT NULL, provider varchar(30) NOT NULL, model varchar(100) NOT NULL,
  analysis jsonb NOT NULL, input_bytes integer NOT NULL, created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(incident_id,evidence_version)
);
DROP TRIGGER IF EXISTS telemetry_ai_analyses_append_only ON telemetry_ai_analyses;
CREATE TRIGGER telemetry_ai_analyses_append_only BEFORE UPDATE OR DELETE ON telemetry_ai_analyses
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();

CREATE TABLE IF NOT EXISTS telemetry_ai_requests (
  id bigserial PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES telemetry_incidents(id) ON DELETE CASCADE,
  admin_user_id integer NOT NULL REFERENCES users(id),
  evidence_version integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telemetry_ai_requests_admin_incident_created_idx
  ON telemetry_ai_requests(admin_user_id,incident_id,created_at DESC);
DROP TRIGGER IF EXISTS telemetry_ai_requests_append_only ON telemetry_ai_requests;
CREATE TRIGGER telemetry_ai_requests_append_only BEFORE UPDATE OR DELETE ON telemetry_ai_requests
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();

-- These records are platform-global and only reachable through audited system
-- context. Revoke application tenant role access even if default grants change.
REVOKE ALL ON telemetry_incidents, telemetry_events, telemetry_incident_audit,
  telemetry_notification_deliveries, telemetry_ai_analyses, telemetry_ai_requests FROM citefi_tenant;

COMMIT;