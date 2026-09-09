BEGIN;

DO $$
DECLARE
  item record;
  table_oid regclass;
  expected_constraint text;
  legacy_index text;
  legacy_index_oid regclass;
BEGIN
  FOR item IN
    SELECT table_name
    FROM (VALUES
      ('campaigns'),
      ('campaign_exports'),
      ('campaign_ads'),
      ('campaign_ad_approvals')
    ) AS campaign_tables(table_name)
  LOOP
    table_oid := to_regclass(format('public.%I', item.table_name));
    IF table_oid IS NULL THEN
      CONTINUE;
    END IF;

    expected_constraint := item.table_name || '_public_id_unique';
    legacy_index := item.table_name || '_public_id_key';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = table_oid
        AND conname = expected_constraint
        AND contype = 'u'
    ) THEN
      legacy_index_oid := to_regclass(format('public.%I', legacy_index));

      IF legacy_index_oid IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM pg_index
          WHERE indexrelid = legacy_index_oid
            AND indisunique
            AND indisvalid
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conindid = legacy_index_oid
        )
      THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE USING INDEX %I',
          item.table_name,
          expected_constraint,
          legacy_index
        );
      ELSE
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (public_id)',
          item.table_name,
          expected_constraint
        );
      END IF;
    END IF;

    legacy_index_oid := to_regclass(format('public.%I', legacy_index));
    IF legacy_index_oid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conindid = legacy_index_oid
      )
    THEN
      EXECUTE format('DROP INDEX %I', legacy_index);
    END IF;
  END LOOP;
END
$$;

COMMIT;