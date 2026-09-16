-- Migration 0035 — converge historical provider-attempt receipt state.
--
-- 0034 was intentionally CREATE TABLE IF NOT EXISTS.  On databases where a
-- declarative schema export created the table first, its state checks were not
-- necessarily present and an old recovery path could write `accounted` without
-- response_usage.  Repair only from an immutable, identity-matching usage
-- ledger event.  No provider response, zero usage, price, refund, or
-- correction is synthesized here.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.provider_attempt_receipts') IS NULL
     OR to_regclass('public.provider_usage_ledger') IS NULL THEN
    RAISE EXCEPTION
      'provider receipt state hardening requires provider receipt and usage ledger tables';
  END IF;
END
$$;

-- Restore a missing/partial response checkpoint only from the immutable
-- native usage columns.  source_event_id, tenant, operation, provider, model,
-- and (when present) provider request identity must all agree.  A known
-- response already present is never overwritten by a different ledger value.
WITH matching_native_usage AS (
  SELECT DISTINCT ON (r.id)
    r.id,
    l.provider_request_id,
    l.unit_type,
    l.unit_count,
    l.input_units,
    l.output_units,
    l.occurred_at
  FROM provider_attempt_receipts r
  JOIN provider_usage_ledger l
    ON l.source_event_id = r.source_event_id
   AND l.team_id = r.team_id
   AND l.event_type = 'usage'
   AND l.operation_type = r.operation_type
   AND l.provider = r.provider
   AND l.model = r.model
   AND (
     r.provider_request_id IS NULL
     OR l.provider_request_id IS NOT DISTINCT FROM r.provider_request_id
   )
   AND l.unit_count IS NOT NULL
   AND l.unit_count >= 0
  WHERE r.status IN ('usage_captured', 'accounted')
    AND (
      r.response_usage IS NULL
      OR r.response_usage->>'known' IS DISTINCT FROM 'true'
     OR jsonb_typeof(r.response_usage->'unitCount') IS DISTINCT FROM 'number'
    )
  ORDER BY r.id, l.occurred_at ASC, l.id ASC
)
UPDATE provider_attempt_receipts r
SET response_usage = jsonb_build_object(
      'unitType', m.unit_type,
      'unitCount', m.unit_count,
      'inputUnits', m.input_units,
      'outputUnits', m.output_units,
      'known', true
    ),
    provider_request_id = COALESCE(r.provider_request_id, m.provider_request_id),
    usage_captured_at = COALESCE(r.usage_captured_at, m.occurred_at),
    failure_code = NULL,
    failure_message = NULL,
    updated_at = now()
FROM matching_native_usage m
WHERE r.id = m.id;

-- Any terminal/checkpoint row that still lacks a genuine aggregate must be
-- held for reconciliation.  This also catches an accounted row whose
-- immutable ledger event disappeared or conflicts with its captured native
-- usage.  Keeping response_usage intact in the latter case preserves
-- ambiguous provider evidence without pretending that it was reconciled.
UPDATE provider_attempt_receipts r
SET status = 'accounting_failed',
    accounted_at = NULL,
    failure_code = COALESCE(failure_code, 'PROVIDER_ATTEMPT_ACCOUNTING_FAILED'),
    failure_message = COALESCE(
      failure_message,
      'provider receipt requires immutable-ledger reconciliation'
    ),
    updated_at = now()
WHERE r.status IN ('usage_captured', 'accounted')
  AND (
    r.response_usage IS NULL
    OR r.response_usage->>'known' IS DISTINCT FROM 'true'
    OR jsonb_typeof(r.response_usage->'unitCount') IS DISTINCT FROM 'number'
    OR NOT EXISTS (
      SELECT 1
      FROM provider_usage_ledger l
      WHERE l.source_event_id = r.source_event_id
        AND l.team_id = r.team_id
        AND l.event_type = 'usage'
        AND l.operation_type = r.operation_type
        AND l.provider = r.provider
        AND l.model = r.model
        AND (
          r.provider_request_id IS NULL
          OR l.provider_request_id IS NOT DISTINCT FROM r.provider_request_id
        )
        AND l.unit_count IS NOT NULL
        AND l.unit_count >= 0
        AND l.unit_type = r.response_usage->>'unitType'
        AND l.unit_count::text = r.response_usage->>'unitCount'
        AND COALESCE(l.input_units::text, '') =
          COALESCE(r.response_usage->>'inputUnits', '')
        AND COALESCE(l.output_units::text, '') =
          COALESCE(r.response_usage->>'outputUnits', '')
    )
  );

-- Keep the canonical names and expressions aligned with shared/schema.ts.
-- Existing 0034 installations already have these names; the guarded adds are
-- for source-schema-first databases only.  They run after the cleanup above,
-- so PostgreSQL validates real historical rows instead of hiding violations.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.provider_attempt_receipts'::regclass
      AND conname = 'provider_attempt_receipts_attempt_check'
  ) THEN
    ALTER TABLE provider_attempt_receipts
      ADD CONSTRAINT provider_attempt_receipts_attempt_check
      CHECK (attempt > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.provider_attempt_receipts'::regclass
      AND conname = 'provider_attempt_receipts_status_check'
  ) THEN
    ALTER TABLE provider_attempt_receipts
      ADD CONSTRAINT provider_attempt_receipts_status_check
      CHECK (status IN (
        'prepared', 'submitted', 'usage_captured', 'accounted',
        'provider_rejected', 'uncertain', 'reconciliation_required',
        'accounting_failed'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.provider_attempt_receipts'::regclass
      AND conname = 'provider_attempt_receipts_usage_status_check'
  ) THEN
    ALTER TABLE provider_attempt_receipts
      ADD CONSTRAINT provider_attempt_receipts_usage_status_check
      CHECK (
        status NOT IN ('usage_captured', 'accounted')
        OR response_usage IS NOT NULL
      );
  END IF;
END
$$;

DO $$
DECLARE
  invalid_constraints integer;
BEGIN
  SELECT count(*) INTO invalid_constraints
  FROM (VALUES
    ('provider_attempt_receipts_attempt_check'),
    ('provider_attempt_receipts_status_check'),
    ('provider_attempt_receipts_usage_status_check')
  ) required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.provider_attempt_receipts'::regclass
      AND c.conname = required.name
      AND c.contype = 'c'
      AND c.convalidated
  );
  IF invalid_constraints <> 0 THEN
    RAISE EXCEPTION
      'provider receipt state hardening constraints were not validated';
  END IF;
END
$$;

COMMIT;