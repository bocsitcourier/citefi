BEGIN;

DO $$
DECLARE
  item record;
  table_oid regclass;
BEGIN
  FOR item IN
    SELECT *
    FROM (VALUES
      (
        'login_challenges',
        'login_challenges_token_hash_key',
        'login_challenges_token_hash_unique'
      ),
      (
        'provider_rate_versions',
        'provider_rate_versions_version_key',
        'provider_rate_versions_version_unique'
      ),
      (
        'provider_usage_ledger',
        'provider_usage_ledger_source_event_id_key',
        'provider_usage_ledger_source_event_id_unique'
      ),
      (
        'stripe_credit_reconciliations',
        'stripe_credit_reconciliations_provider_object_id_key',
        'stripe_credit_reconciliations_provider_object_id_unique'
      )
    ) AS legacy_constraints(table_name, old_name, expected_name)
  LOOP
    table_oid := to_regclass(format('public.%I', item.table_name));
    IF table_oid IS NULL THEN
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = table_oid
        AND conname = item.expected_name
        AND contype = 'u'
    ) AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = table_oid
        AND conname = item.old_name
        AND contype = 'u'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
        item.table_name,
        item.old_name,
        item.expected_name
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;