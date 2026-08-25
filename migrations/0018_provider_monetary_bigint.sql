-- Task #153 upgrade path: widen monetary micro-USD columns created by the
-- original 0017 migration. ALTER TYPE is data-preserving and this migration is
-- safe to re-run because each already-bigint column is skipped.
BEGIN;

DO $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      ('provider_rates', 'input_microusd_per_million'),
      ('provider_rates', 'output_microusd_per_million'),
      ('provider_rates', 'microusd_per_unit'),
      ('provider_usage_ledger', 'cost_microusd'),
      ('provider_invoice_reconciliations', 'invoiced_cost_microusd'),
      ('provider_invoice_reconciliations', 'ledger_cost_microusd'),
      ('provider_invoice_reconciliations', 'variance_microusd')
    ) AS columns_to_widen(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target.table_name
        AND column_name = target.column_name
        AND data_type <> 'bigint'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE bigint USING %I::bigint',
        target.table_name,
        target.column_name,
        target.column_name
      );
    END IF;
  END LOOP;
END $$;

COMMIT;