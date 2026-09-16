-- Historical provider-attempt receipt fixture.
--
-- This runs against the disposable 55481 cluster after the normal baseline
-- has been composed.  It deliberately removes only the three state checks,
-- seeds rows that predate state hardening, runs 0035, then proves that the
-- checks reject invalid writes.  It never targets an application database.
\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE provider_attempt_receipts
  DROP CONSTRAINT IF EXISTS provider_attempt_receipts_attempt_check,
  DROP CONSTRAINT IF EXISTS provider_attempt_receipts_status_check,
  DROP CONSTRAINT IF EXISTS provider_attempt_receipts_usage_status_check;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = 'public.provider_attempt_receipts'::regclass
      AND conname IN (
        'provider_attempt_receipts_attempt_check',
        'provider_attempt_receipts_status_check',
        'provider_attempt_receipts_usage_status_check'
      )
  ) <> 0 THEN
    RAISE EXCEPTION 'historical fixture still has canonical state checks';
  END IF;
END
$$;

-- A valid native ledger event must backfill the missing aggregate, including
-- the known=true / absent unitCount case that exposed the NULL comparison bug.
INSERT INTO provider_attempt_receipts (
  source_event_id, team_id, operation_type, provider, model, attempt,
  request_metadata, provider_request_id, response_usage, status, accounted_at
)
SELECT
  'qa-0035-matching-ledger', id, 'qa_migration_fixture', 'gemini',
  'qa-migration-model', 1, '{}'::jsonb, 'qa-request-match',
  '{"known": true}'::jsonb, 'accounted', now()
FROM teams
WHERE name = 'QA Isolated Tenant A';

INSERT INTO provider_usage_ledger (
  source_event_id, team_id, event_type, operation_type, provider, model,
  unit_type, input_units, output_units, unit_count, cost_microusd,
  rate_snapshot, provider_request_id, occurred_at
)
SELECT
  'qa-0035-matching-ledger', id, 'usage', 'qa_migration_fixture', 'gemini',
  'qa-migration-model', 'tokens', 5, 2, 7, 1234, '{}'::jsonb,
  'qa-request-match', now()
FROM teams
WHERE name = 'QA Isolated Tenant A';

-- Missing and malformed aggregates have no trustworthy native evidence.
INSERT INTO provider_attempt_receipts (
  source_event_id, team_id, operation_type, provider, model, attempt,
  request_metadata, status, response_usage, accounted_at
)
SELECT
  fixture.source_event_id, teams.id, 'qa_migration_fixture', 'gemini',
  'qa-migration-model', 1, '{}'::jsonb, fixture.status,
  fixture.response_usage, now()
FROM teams
CROSS JOIN (
  VALUES
    ('qa-0035-missing-aggregate', 'accounted', NULL::jsonb),
    ('qa-0035-malformed-aggregate', 'accounted',
      '{"known": true, "unitType": "tokens", "unitCount": "not-a-number"}'::jsonb)
) AS fixture(source_event_id, status, response_usage)
WHERE teams.name = 'QA Isolated Tenant A';

-- The following four rows each have a ledger event with one conflicting
-- identity dimension.  None may be trusted for response backfill.
INSERT INTO provider_attempt_receipts (
  source_event_id, team_id, operation_type, provider, model, attempt,
  request_metadata, provider_request_id, status
)
SELECT fixture.source_event_id, teams.id, 'qa_migration_fixture', 'gemini',
       fixture.receipt_model, 1, '{}'::jsonb, fixture.receipt_request_id,
       'accounted'
FROM teams
CROSS JOIN (
  VALUES
    ('qa-0035-tenant-conflict', 'qa-migration-model', NULL::varchar),
    ('qa-0035-provider-conflict', 'qa-migration-model', NULL::varchar),
    ('qa-0035-model-conflict', 'qa-migration-model', NULL::varchar),
    ('qa-0035-request-conflict', 'qa-migration-model', 'qa-request-receipt'::varchar)
) AS fixture(source_event_id, receipt_model, receipt_request_id)
WHERE teams.name = 'QA Isolated Tenant A';

-- Change only the provider/model/request dimensions in the ledger rows below;
-- the tenant conflict is represented by the second QA team.
INSERT INTO provider_usage_ledger (
  source_event_id, team_id, event_type, operation_type, provider, model,
  unit_type, input_units, output_units, unit_count, cost_microusd,
  rate_snapshot, provider_request_id, occurred_at
)
SELECT 'qa-0035-tenant-conflict', id, 'usage', 'qa_migration_fixture',
       'gemini', 'qa-migration-model', 'tokens', 1, 1, 2, 4321,
       '{}'::jsonb, NULL, now()
FROM teams
WHERE name = 'QA Isolated Tenant B';

INSERT INTO provider_usage_ledger (
  source_event_id, team_id, event_type, operation_type, provider, model,
  unit_type, input_units, output_units, unit_count, cost_microusd,
  rate_snapshot, provider_request_id, occurred_at
)
SELECT fixture.source_event_id, teams.id, 'usage', 'qa_migration_fixture',
       fixture.ledger_provider, fixture.ledger_model, 'tokens', 1, 1, 2, 4321,
       '{}'::jsonb, fixture.ledger_request_id, now()
FROM teams
CROSS JOIN (
  VALUES
    ('qa-0035-provider-conflict', 'openai', 'qa-migration-model', NULL::varchar),
    ('qa-0035-model-conflict', 'gemini', 'different-migration-model', NULL::varchar),
    ('qa-0035-request-conflict', 'gemini', 'qa-migration-model', 'qa-request-ledger'::varchar)
) AS fixture(source_event_id, ledger_provider, ledger_model, ledger_request_id)
WHERE teams.name = 'QA Isolated Tenant A';

DO $$
BEGIN
  IF (
    SELECT count(*) FROM provider_attempt_receipts
    WHERE source_event_id LIKE 'qa-0035-%'
  ) <> 7 THEN
    RAISE EXCEPTION 'historical fixture did not seed seven receipt rows';
  END IF;
END
$$;

COMMIT;

\echo 'Applying migration 0035 to historical rows'
\ir ../migrations/0035_provider_attempt_receipt_state_hardening.sql

DO $$
DECLARE
  matching jsonb;
  missing jsonb;
  malformed jsonb;
  invalid_count integer;
BEGIN
  SELECT response_usage INTO matching
  FROM provider_attempt_receipts
  WHERE source_event_id = 'qa-0035-matching-ledger';
  IF matching->>'known' IS DISTINCT FROM 'true'
     OR matching->>'unitType' IS DISTINCT FROM 'tokens'
     OR matching->>'unitCount' IS DISTINCT FROM '7'
     OR matching->>'inputUnits' IS DISTINCT FROM '5'
     OR matching->>'outputUnits' IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'matching immutable ledger evidence was not backfilled: %', matching;
  END IF;

  SELECT response_usage INTO missing
  FROM provider_attempt_receipts
  WHERE source_event_id = 'qa-0035-missing-aggregate';
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'missing evidence fabricated an aggregate: %', missing;
  END IF;

  SELECT response_usage INTO malformed
  FROM provider_attempt_receipts
  WHERE source_event_id = 'qa-0035-malformed-aggregate';
  IF malformed->>'unitCount' IS DISTINCT FROM 'not-a-number' THEN
    RAISE EXCEPTION 'ambiguous malformed usage was overwritten: %', malformed;
  END IF;

  IF EXISTS (
    SELECT 1 FROM provider_attempt_receipts
    WHERE source_event_id IN (
      'qa-0035-tenant-conflict',
      'qa-0035-provider-conflict',
      'qa-0035-model-conflict',
      'qa-0035-request-conflict'
    )
    AND response_usage IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'conflicting ledger identity was trusted for backfill';
  END IF;

  IF EXISTS (
    SELECT 1 FROM provider_attempt_receipts
    WHERE source_event_id LIKE 'qa-0035-%'
      AND status <> 'accounting_failed'
      AND source_event_id <> 'qa-0035-matching-ledger'
  ) THEN
    RAISE EXCEPTION 'historical rows without matching evidence were not downgraded';
  END IF;

  IF EXISTS (
    SELECT 1 FROM provider_attempt_receipts
    WHERE source_event_id LIKE 'qa-0035-%'
      AND source_event_id <> 'qa-0035-matching-ledger'
      AND accounted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'downgraded accounted row retained accounted_at';
  END IF;

  SELECT count(*) INTO invalid_count
  FROM pg_constraint
  WHERE conrelid = 'public.provider_attempt_receipts'::regclass
    AND conname IN (
      'provider_attempt_receipts_attempt_check',
      'provider_attempt_receipts_status_check',
      'provider_attempt_receipts_usage_status_check'
    )
    AND contype = 'c' AND convalidated;
  IF invalid_count <> 3 THEN
    RAISE EXCEPTION 'expected three validated canonical state checks, found %', invalid_count;
  END IF;
END
$$;

-- Canonical checks must reject all three classes of invalid historical writes.
DO $$
BEGIN
  BEGIN
    INSERT INTO provider_attempt_receipts (
      source_event_id, team_id, operation_type, provider, model, attempt,
      request_metadata
    )
    SELECT 'qa-0035-invalid-attempt', id, 'qa_migration_fixture', 'gemini',
           'qa-migration-model', 0, '{}'::jsonb
    FROM teams WHERE name = 'QA Isolated Tenant A';
    RAISE EXCEPTION 'attempt check accepted zero';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO provider_attempt_receipts (
      source_event_id, team_id, operation_type, provider, model, request_metadata,
      status
    )
    SELECT 'qa-0035-invalid-status', id, 'qa_migration_fixture', 'gemini',
           'qa-migration-model', '{}'::jsonb, 'not-a-receipt-state'
    FROM teams WHERE name = 'QA Isolated Tenant A';
    RAISE EXCEPTION 'status check accepted an unknown state';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO provider_attempt_receipts (
      source_event_id, team_id, operation_type, provider, model, request_metadata,
      status
    )
    SELECT 'qa-0035-invalid-usage', id, 'qa_migration_fixture', 'gemini',
           'qa-migration-model', '{}'::jsonb, 'accounted'
    FROM teams WHERE name = 'QA Isolated Tenant A';
    RAISE EXCEPTION 'usage-state check accepted accounted without usage';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$$;

\echo 'Re-running migration 0035 for idempotent historical convergence'
\ir ../migrations/0035_provider_attempt_receipt_state_hardening.sql

DO $$
BEGIN
  IF (
    SELECT count(*) FROM provider_attempt_receipts
    WHERE source_event_id LIKE 'qa-0035-%'
  ) <> 7 THEN
    RAISE EXCEPTION 'migration re-execution changed historical fixture cardinality';
  END IF;
END
$$;

\echo 'PASS: 0035 repaired matching native evidence, preserved conflicts, downgraded ambiguous rows, and validated all state checks'