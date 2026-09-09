BEGIN;

DO $$
DECLARE
  item record;
  source_oid regclass;
  target_oid regclass;
  source_attnum smallint;
  target_attnum smallint;
  existing_constraint text;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      ('telemetry_incidents', 'acknowledged_by', 'users', 'id', 'NO ACTION'),
      ('telemetry_incidents', 'assignee_user_id', 'users', 'id', 'NO ACTION'),
      ('telemetry_events', 'incident_id', 'telemetry_incidents', 'id', 'SET NULL'),
      ('telemetry_incident_audit', 'incident_id', 'telemetry_incidents', 'id', 'CASCADE'),
      ('telemetry_incident_audit', 'actor_user_id', 'users', 'id', 'NO ACTION'),
      ('telemetry_notification_deliveries', 'incident_id', 'telemetry_incidents', 'id', 'CASCADE'),
      ('telemetry_notification_deliveries', 'admin_user_id', 'users', 'id', 'CASCADE'),
      ('telemetry_ai_analyses', 'incident_id', 'telemetry_incidents', 'id', 'CASCADE'),
      ('telemetry_ai_requests', 'incident_id', 'telemetry_incidents', 'id', 'CASCADE'),
      ('telemetry_ai_requests', 'admin_user_id', 'users', 'id', 'NO ACTION')
    ) AS foreign_keys(
      source_table,
      source_column,
      target_table,
      target_column,
      delete_action
    )
  LOOP
    source_oid := to_regclass(format('public.%I', item.source_table));
    target_oid := to_regclass(format('public.%I', item.target_table));
    IF source_oid IS NULL OR target_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT attnum
    INTO source_attnum
    FROM pg_attribute
    WHERE attrelid = source_oid
      AND attname = item.source_column
      AND NOT attisdropped;

    SELECT attnum
    INTO target_attnum
    FROM pg_attribute
    WHERE attrelid = target_oid
      AND attname = item.target_column
      AND NOT attisdropped;

    SELECT conname
    INTO existing_constraint
    FROM pg_constraint
    WHERE conrelid = source_oid
      AND contype = 'f'
      AND confrelid = target_oid
      AND conkey = ARRAY[source_attnum]::smallint[]
      AND confkey = ARRAY[target_attnum]::smallint[]
    LIMIT 1;

    IF existing_constraint IS NULL THEN
      existing_constraint := item.source_table || '_' || item.source_column || '_fkey';
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I (%I) ON DELETE %s NOT VALID',
        item.source_table,
        existing_constraint,
        item.source_column,
        item.target_table,
        item.target_column,
        item.delete_action
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      item.source_table,
      existing_constraint
    );
    existing_constraint := NULL;
  END LOOP;
END
$$;

DO $$
DECLARE
  item record;
  table_oid regclass;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      (
        'telemetry_incidents',
        'telemetry_incidents_severity_check',
        'severity IN (''warning'', ''error'', ''critical'')'
      ),
      (
        'telemetry_incidents',
        'telemetry_incidents_status_check',
        'status IN (''open'', ''acknowledged'', ''resolved'', ''ignored'')'
      ),
      (
        'telemetry_incidents',
        'telemetry_incidents_count_check',
        'occurrence_count > 0 AND evidence_version > 0'
      ),
      (
        'telemetry_events',
        'telemetry_events_severity_check',
        'severity IN (''warning'', ''error'', ''critical'')'
      )
    ) AS check_constraints(table_name, constraint_name, expression)
  LOOP
    table_oid := to_regclass(format('public.%I', item.table_name));
    IF table_oid IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = table_oid
        AND conname = item.constraint_name
        AND contype = 'c'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID',
        item.table_name,
        item.constraint_name,
        item.expression
      );
    END IF;

    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      item.table_name,
      item.constraint_name
    );
  END LOOP;
END
$$;

COMMIT;