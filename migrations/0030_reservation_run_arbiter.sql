BEGIN;

-- A schema push can drop a SQL UNIQUE constraint when the ORM describes it
-- as a standalone index with the same name. Preserve the original constraint
-- shape; fail rather than delete financial history if duplicate runs exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.credit_reservations'::regclass
      AND conname = 'credit_reservations_team_run_unique' AND contype = 'u'
  ) THEN
    IF to_regclass('public.credit_reservations_team_run_unique') IS NOT NULL THEN
      ALTER TABLE public.credit_reservations
        ADD CONSTRAINT credit_reservations_team_run_unique
        UNIQUE USING INDEX credit_reservations_team_run_unique;
    ELSE
      ALTER TABLE public.credit_reservations
        ADD CONSTRAINT credit_reservations_team_run_unique UNIQUE (team_id, run_id);
    END IF;
  END IF;
END $$;

COMMIT;