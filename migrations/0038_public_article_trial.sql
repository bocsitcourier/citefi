CREATE TABLE IF NOT EXISTS public_trial_documents (
 id serial PRIMARY KEY,
 token_hash varchar(64) NOT NULL UNIQUE,
 ip_hash varchar(64) NOT NULL,
 team_id integer REFERENCES teams(id),
 owner_user_id integer UNIQUE REFERENCES users(id),
 status varchar(20) NOT NULL DEFAULT 'created'
   CHECK (status IN ('created','generating','ready','uncertain')),
 input jsonb,
 title text,
 preview text,
 full_text text,
 reserve_microusd integer NOT NULL DEFAULT 0 CHECK (reserve_microusd >= 0),
 created_at timestamp NOT NULL DEFAULT now(),
 started_at timestamp,
 expires_at timestamp NOT NULL,
 CHECK (owner_user_id IS NULL OR status = 'ready')
);
CREATE INDEX IF NOT EXISTS public_trial_admission_idx ON public_trial_documents(started_at);
CREATE INDEX IF NOT EXISTS public_trial_ip_idx ON public_trial_documents(ip_hash,started_at);
CREATE TABLE IF NOT EXISTS public_trial_sponsor (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 team_id integer NOT NULL UNIQUE REFERENCES teams(id)
);
-- This feature owns a separate, non-customer, non-canary accounting workspace.
-- Provision explicitly as part of the approved migration, never adopt a team
-- supplied by a visitor or discovered from customer memberships.
DO $$
DECLARE owner_id integer; sponsor_id integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public_trial_sponsor) THEN
  SELECT id INTO owner_id FROM users WHERE role='admin' AND account_status='active' ORDER BY id LIMIT 1;
  IF owner_id IS NOT NULL THEN
   INSERT INTO teams(name,created_by,billing_plan,billing_status)
    VALUES ('Citefi public article trial sponsor',owner_id,'free','active') RETURNING id INTO sponsor_id;
   INSERT INTO public_trial_sponsor(singleton,team_id) VALUES(true,sponsor_id);
  END IF;
 END IF;
END $$;
-- No tenant, browser, or public SQL role may access capability hashes/content.
ALTER TABLE public_trial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_trial_sponsor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public_trial_documents,public_trial_sponsor FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='citefi_tenant') THEN
  GRANT SELECT ON public_trial_documents TO citefi_tenant;
  DROP POLICY IF EXISTS trial_provider_attribution ON public_trial_documents;
  CREATE POLICY trial_provider_attribution ON public_trial_documents FOR SELECT
    TO citefi_tenant USING(team_id = nullif(current_setting('citefi.team_id',true),'')::integer
      AND current_setting('citefi.actor_type',true)='worker');
 END IF;
END $$;
