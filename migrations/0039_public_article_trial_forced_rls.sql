-- Forward-only repair: 0038 is already recorded in the immutable migration ledger.
-- Require row-security enforcement for both capability and sponsor storage.
-- Existing bounded system-role callbacks retain their established authority;
-- no public or tenant privileges or policies are broadened.
ALTER TABLE public_trial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_trial_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public_trial_sponsor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_trial_sponsor FORCE ROW LEVEL SECURITY;
