BEGIN;

-- Policies/FORCE survive a declarative push which disables RLS. Restore the
-- previously intended controls without changing any access policy or data.
ALTER TABLE public.provider_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_usage_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_rate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_rate_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.provider_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_ads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_ad_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_ad_approvals FORCE ROW LEVEL SECURITY;

COMMIT;