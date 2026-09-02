BEGIN;
-- Ledger and Stripe reconciliation history are deliberately preserved.
ALTER TABLE credit_ledger DROP COLUMN IF EXISTS reversed_credits;
ALTER TABLE credit_ledger DROP COLUMN IF EXISTS stripe_checkout_session_id;
ALTER TABLE credit_ledger DROP COLUMN IF EXISTS stripe_payment_intent_id;
ALTER TABLE credit_ledger DROP COLUMN IF EXISTS stripe_invoice_id;
ALTER TABLE credit_balances DROP COLUMN IF EXISTS purchased_debt;
ALTER TABLE credit_balances DROP COLUMN IF EXISTS allowance_debt;
ALTER TABLE campaign_ad_approvals DROP COLUMN IF EXISTS authority_snapshot;
ALTER TABLE campaigns DROP COLUMN IF EXISTS client_team_id;
ALTER TABLE teams DROP COLUMN IF EXISTS designated_client_approver_user_id;
ALTER TABLE credit_reservations RENAME TO credit_reservations_history;
ALTER TABLE stripe_credit_reconciliations RENAME TO stripe_credit_reconciliations_history;
COMMIT;