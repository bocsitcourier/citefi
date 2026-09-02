CREATE TABLE IF NOT EXISTS login_challenges (
  id serial PRIMARY KEY,
  token_hash varchar(64) NOT NULL UNIQUE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method varchar(20) NOT NULL CHECK (method IN ('totp', 'email')),
  email_code_hash varchar(64),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamp NOT NULL,
  consumed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT login_challenges_email_code CHECK (
    (method = 'email' AND email_code_hash IS NOT NULL) OR
    (method = 'totp' AND email_code_hash IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS login_challenges_token_hash_idx ON login_challenges(token_hash);
CREATE INDEX IF NOT EXISTS login_challenges_user_active_idx
  ON login_challenges(user_id, consumed_at, expires_at);