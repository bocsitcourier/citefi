-- Roll back Task #152 only after Ads Lab application code has been rolled back.
BEGIN;
DROP TRIGGER IF EXISTS campaign_ad_approvals_append_only ON campaign_ad_approvals;
DROP TRIGGER IF EXISTS campaign_ads_immutable ON campaign_ads;
DROP TRIGGER IF EXISTS campaigns_brand_snapshot_immutable ON campaigns;
DROP FUNCTION IF EXISTS citefi_rls.guard_ad_approval_audit();
DROP FUNCTION IF EXISTS citefi_rls.guard_ads_immutability();
DROP FUNCTION IF EXISTS citefi_rls.guard_confirmed_campaign_brand();
DROP TABLE IF EXISTS campaign_ad_approvals;
DROP TABLE IF EXISTS campaign_ads;
COMMIT;