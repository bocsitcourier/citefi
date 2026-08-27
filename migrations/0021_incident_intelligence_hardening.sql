BEGIN;

ALTER TABLE telemetry_incidents
  ADD COLUMN IF NOT EXISTS assignee_user_id integer REFERENCES users(id);

-- Preserve assignments made before assignee state became durable. The regexp
-- avoids casting arbitrary historical notes as JSON.
WITH latest AS (
  SELECT DISTINCT ON (incident_id)
    incident_id,
    ((regexp_match(note, '"assigneeUserId"\s*:\s*(\d+)'))[1])::integer AS assignee_user_id
  FROM telemetry_incident_audit
  WHERE action = 'assigned'
    AND note ~ '"assigneeUserId"\s*:\s*\d+'
  ORDER BY incident_id, created_at DESC, id DESC
)
UPDATE telemetry_incidents i
SET assignee_user_id = latest.assignee_user_id
FROM latest
WHERE i.id = latest.incident_id
  AND i.assignee_user_id IS NULL;

DROP INDEX IF EXISTS telemetry_notification_deliveries_unique;
DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'telemetry_notification_deliveries'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) NOT ILIKE '%evidence_version%'
  LOOP
    EXECUTE format('ALTER TABLE telemetry_notification_deliveries DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_notification_deliveries_unique
  ON telemetry_notification_deliveries(incident_id,admin_user_id,notification_kind,evidence_version);

CREATE OR REPLACE FUNCTION telemetry_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS telemetry_incident_audit_append_only ON telemetry_incident_audit;
CREATE TRIGGER telemetry_incident_audit_append_only BEFORE UPDATE OR DELETE ON telemetry_incident_audit
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();
DROP TRIGGER IF EXISTS telemetry_notification_deliveries_append_only ON telemetry_notification_deliveries;
CREATE TRIGGER telemetry_notification_deliveries_append_only BEFORE UPDATE OR DELETE ON telemetry_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION telemetry_append_only_guard();
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

REVOKE ALL ON telemetry_ai_requests FROM citefi_tenant;

COMMIT;