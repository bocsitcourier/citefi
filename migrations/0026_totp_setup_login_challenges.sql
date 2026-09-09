BEGIN;

ALTER TABLE login_challenges
  DROP CONSTRAINT IF EXISTS login_challenges_method_check;
ALTER TABLE login_challenges
  ADD CONSTRAINT login_challenges_method_check
  CHECK (method IN ('totp', 'email', 'totp_setup'));

ALTER TABLE login_challenges
  DROP CONSTRAINT IF EXISTS login_challenges_email_code;
ALTER TABLE login_challenges
  ADD CONSTRAINT login_challenges_email_code
  CHECK (
    (method = 'email' AND email_code_hash IS NOT NULL) OR
    (method IN ('totp', 'totp_setup') AND email_code_hash IS NULL)
  );

COMMIT;