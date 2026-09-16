-- RC5: close the agency-report idempotency gap on databases where db:push
-- created agency_client_reports before migration 0019 ran.
--
-- This is deliberately additive and fails closed when historical duplicates
-- exist. It never deletes or rewrites report rows. The application performs a
-- read-only readiness check before generation and does not create this index at
-- request time.
BEGIN;

DO $$
DECLARE duplicate_groups bigint;
BEGIN
  IF to_regclass('public.agency_client_reports') IS NULL THEN
    RAISE EXCEPTION
      'agency report period uniqueness prerequisite requires public.agency_client_reports';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class idx
    JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = 'public'
      AND idx.relname = 'agency_client_reports_period_unique'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = idx.relnamespace
    WHERE n.nspname = 'public'
      AND idx.relname = 'agency_client_reports_period_unique'
      AND tbl.oid = 'public.agency_client_reports'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indisready
      AND i.indnkeyatts = 4
      AND i.indnatts = 4
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indkey[0] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = tbl.oid AND attname = 'agency_team_id' AND NOT attisdropped
      )
      AND i.indkey[1] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = tbl.oid AND attname = 'client_team_id' AND NOT attisdropped
      )
      AND i.indkey[2] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = tbl.oid AND attname = 'period_start' AND NOT attisdropped
      )
      AND i.indkey[3] = (
        SELECT attnum FROM pg_attribute
        WHERE attrelid = tbl.oid AND attname = 'period_end' AND NOT attisdropped
      )
  ) THEN
    RAISE EXCEPTION
      'agency report period uniqueness prerequisite found an incompatible index named agency_client_reports_period_unique';
  END IF;

  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT agency_team_id, client_team_id, period_start, period_end
    FROM agency_client_reports
    GROUP BY agency_team_id, client_team_id, period_start, period_end
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'agency report period uniqueness prerequisite found % duplicate key group(s); no rows were deleted',
      duplicate_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agency_client_reports_period_unique
  ON agency_client_reports(agency_team_id, client_team_id, period_start, period_end);

COMMIT;