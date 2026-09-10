BEGIN;

-- An accepted/ambiguous provider operation is not a safe refund decision.
-- Keep its existing RESERVED hold and require explicit reconciliation rather
-- than introducing an incompatible financial terminal state.
ALTER TABLE public.credit_reservations
  ADD COLUMN IF NOT EXISTS reconciliation_required_at timestamp,
  ADD COLUMN IF NOT EXISTS reconciliation_reason text;

COMMIT;