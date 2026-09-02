BEGIN;

ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS allowance_debt integer NOT NULL DEFAULT 0 CHECK (allowance_debt >= 0);
ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS purchased_debt integer NOT NULL DEFAULT 0 CHECK (purchased_debt >= 0);
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS reversed_credits integer NOT NULL DEFAULT 0 CHECK (reversed_credits >= 0);
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS stripe_checkout_session_id varchar(255);
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS stripe_payment_intent_id varchar(255);
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS stripe_invoice_id varchar(255);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_checkout_unique ON credit_ledger(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL AND event_type='grant';
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_payment_intent_unique ON credit_ledger(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND event_type='grant';
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe_invoice_unique ON credit_ledger(stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL AND event_type='grant';

CREATE TABLE IF NOT EXISTS credit_reservations (
  id bigserial PRIMARY KEY,
  team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  run_id varchar(255) NOT NULL,
  operation_type varchar(50) NOT NULL,
  original_amount integer NOT NULL CHECK (original_amount > 0),
  remaining_amount integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'RESERVED',
  request_key varchar(255),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT credit_reservations_team_run_unique UNIQUE(team_id,run_id),
  CONSTRAINT credit_reservations_amounts_check CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount),
  CONSTRAINT credit_reservations_status_check CHECK
    (status IN ('RESERVED','DEBITED','RELEASED') AND (status='RESERVED' OR remaining_amount=0))
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_reservations_team_request_unique
  ON credit_reservations(team_id,request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_reservations_outstanding_idx ON credit_reservations(status,updated_at);

CREATE TABLE IF NOT EXISTS credit_reservation_quarantine (
  reserve_ledger_id integer PRIMARY KEY REFERENCES credit_ledger(id),
  team_id integer NOT NULL, run_id varchar(255), reason text NOT NULL,
  snapshot jsonb NOT NULL, quarantined_at timestamp NOT NULL DEFAULT now()
);

-- Only unambiguous historical reservations are promoted. Duplicate run IDs,
-- missing IDs, over-settlement, and mixed operation/amount records are retained
-- in the append-only ledger and explicitly quarantined for operator review.
WITH candidates AS (
  SELECT r.id, r.team_id, r.run_id, r.operation_type, r.amount,
    COALESCE(SUM(CASE WHEN s.event_type IN ('debit','release') THEN abs(s.amount) ELSE 0 END),0)::integer settled,
    count(*) OVER (PARTITION BY r.team_id,r.run_id) duplicate_count
  FROM credit_ledger r
  LEFT JOIN credit_ledger s ON s.team_id=r.team_id AND s.run_id=r.run_id
    AND s.event_type IN ('debit','release')
  WHERE r.event_type='reserve'
  GROUP BY r.id,r.team_id,r.run_id,r.operation_type,r.amount
), invalid AS (
  SELECT * FROM candidates WHERE run_id IS NULL OR duplicate_count<>1 OR amount<=0 OR settled>amount
)
INSERT INTO credit_reservation_quarantine(reserve_ledger_id,team_id,run_id,reason,snapshot)
SELECT id,team_id,run_id,'ambiguous or over-settled legacy reservation',
       jsonb_build_object('amount',amount,'settled',settled,'duplicates',duplicate_count)
FROM invalid
ON CONFLICT (reserve_ledger_id) DO NOTHING;

WITH candidates AS (
  SELECT r.id, r.team_id, r.run_id, COALESCE(r.operation_type,r.product_type,'legacy') operation_type, r.amount,
    COALESCE(SUM(CASE WHEN s.event_type IN ('debit','release') THEN abs(s.amount) ELSE 0 END),0)::integer settled,
    count(*) OVER (PARTITION BY r.team_id,r.run_id) duplicate_count
  FROM credit_ledger r
  LEFT JOIN credit_ledger s ON s.team_id=r.team_id AND s.run_id=r.run_id
    AND s.event_type IN ('debit','release')
  WHERE r.event_type='reserve'
  GROUP BY r.id,r.team_id,r.run_id,r.operation_type,r.product_type,r.amount
)
INSERT INTO credit_reservations(team_id,run_id,operation_type,original_amount,remaining_amount,status,created_at)
SELECT team_id,run_id,operation_type,amount,amount-settled,
  CASE WHEN amount=settled THEN
    CASE WHEN EXISTS(SELECT 1 FROM credit_ledger x WHERE x.team_id=c.team_id AND x.run_id=c.run_id AND x.event_type='debit')
      THEN 'DEBITED' ELSE 'RELEASED' END
    ELSE 'RESERVED' END, now()
FROM candidates c WHERE run_id IS NOT NULL AND duplicate_count=1 AND amount>0 AND settled<=amount
ON CONFLICT (team_id,run_id) DO NOTHING;

WITH inconsistent_teams AS (
  SELECT b.team_id
  FROM credit_balances b
  LEFT JOIN credit_reservations r ON r.team_id=b.team_id AND r.status='RESERVED'
  GROUP BY b.team_id,b.reserved_credits
  HAVING COALESCE(sum(r.remaining_amount),0) <> b.reserved_credits
)
INSERT INTO credit_reservation_quarantine(reserve_ledger_id,team_id,run_id,reason,snapshot)
SELECT l.id,l.team_id,l.run_id,'team aggregate does not match per-run outstanding holds',
  jsonb_build_object('reservedCredits',b.reserved_credits)
FROM credit_ledger l JOIN inconsistent_teams i ON i.team_id=l.team_id
JOIN credit_balances b ON b.team_id=l.team_id
WHERE l.event_type='reserve'
ON CONFLICT (reserve_ledger_id) DO NOTHING;

DELETE FROM credit_reservations r USING (
  SELECT b.team_id
  FROM credit_balances b LEFT JOIN credit_reservations x ON x.team_id=b.team_id AND x.status='RESERVED'
  GROUP BY b.team_id,b.reserved_credits
  HAVING COALESCE(sum(x.remaining_amount),0) <> b.reserved_credits
) bad WHERE r.team_id=bad.team_id;

CREATE TABLE IF NOT EXISTS stripe_credit_reconciliations (
 id bigserial PRIMARY KEY, team_id integer NOT NULL REFERENCES teams(id),
 provider_object_id varchar(255) NOT NULL UNIQUE, object_type varchar(30) NOT NULL,
 charge_id varchar(255), refund_id varchar(255), dispute_id varchar(255), invoice_id varchar(255),
 payment_intent_id varchar(255), checkout_session_id varchar(255),
 original_grant_id integer REFERENCES credit_ledger(id), currency_amount integer NOT NULL,
 credits_reversed integer NOT NULL DEFAULT 0, status varchar(30) NOT NULL DEFAULT 'pending',
 payload jsonb, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamp NOT NULL DEFAULT now(),
 last_error text, processed_at timestamp, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
 CHECK(currency_amount >= 0), CHECK(credits_reversed >= 0),
 CHECK(status IN ('pending','processing','completed','failed','cancelled'))
);
CREATE INDEX IF NOT EXISTS stripe_credit_reconciliation_retry_idx ON stripe_credit_reconciliations(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS stripe_credit_reconciliation_charge_idx ON stripe_credit_reconciliations(charge_id);

ALTER TABLE teams ADD COLUMN IF NOT EXISTS designated_client_approver_user_id integer REFERENCES users(id);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS client_team_id integer REFERENCES teams(id);
ALTER TABLE campaign_ad_approvals ADD COLUMN IF NOT EXISTS authority_snapshot jsonb;

COMMIT;