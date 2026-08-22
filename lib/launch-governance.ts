/**
 * Locked launch governance for the consolidated Citefi blueprint.
 *
 * This module records business and policy defaults that code alone cannot infer.
 * It is intentionally data-only so QA, reporting, and future admin controls can
 * consume the same decisions without reinterpreting the blueprint.
 */

export const LAUNCH_POLICY_VERSION = "2026-08-22";

export const COMMERCIAL_LAUNCH_DEFAULTS = {
  pricingSource: "lib/billing/plans.ts",
  creditMenuSource: "lib/credit-menu.ts",
  annualBilling: {
    serviceMonths: 12,
    chargedMonths: 10,
    discountLabel: "two months free",
  },
  freeTier: {
    credits: 30,
    creditRefresh: "one_time",
    maxSeats: 1,
    maxVerifiedOrganizations: 1,
    paymentCardRequired: false,
    directAdPublishing: false,
    directSocialPublishing: false,
    mediaWatermarkRequired: true,
  },
  overagePolicy: {
    automaticMeteredOverage: false,
    remedy: "purchase_top_up_or_change_plan",
    topUpCreditsExpire: false,
  },
  marginPolicy: {
    minimumGrossMarginPctPerCredit: 75,
    maximumNegativeMarginWorkspacePct: 2,
    pricingPercentile: "p90",
    certificationWindowDays: 30,
    minimumSuccessfulSamplesPerOperation: 100,
  },
  providerCostPolicy: {
    accountingCurrency: "USD",
    primarySource: "recorded_provider_usage_at_the_rate_card_effective_when_the_call_was_made",
    reconciliationSource: "monthly_provider_invoice_or_billing_export",
    failedCallCostsRemainVisible: true,
    unknownOrZeroPricedModel: "blocks_margin_certification",
    repriceTriggers: [
      "provider_rate_change",
      "model_change",
      "prompt_or_pipeline_change",
      "material_p90_cost_shift",
    ],
  },
  agencyRebilling: {
    mode: "agency_managed_external_billing",
    pooledCredits: false,
    clientWorkspaceBalances: "separate",
    automaticMarkup: false,
    citefiInvoicesAgencyClients: false,
    clientCanSeeProviderCostOrMargin: false,
    usageExportOwner: "agency_workspace_owner",
  },
  veoMetering: {
    separateCreditBucketAtLaunch: false,
    policy: "unified_credits_with_hard_cost_ceiling",
    reconsiderAfterMeasuredProviderLedger: true,
  },
} as const;

export const PRODUCT_POLICY_DEFAULTS = {
  positioning: {
    productCategory: "Local Marketing Campaign Engine",
    promise: "Create complete local marketing campaigns from one business URL.",
    canonicalParent: "campaign",
    legacyGenerationUnit: "batch",
  },
  reports: {
    recordOwner: "agency_workspace",
    brandOwner: "agency_workspace_owner",
    contentApprover: "designated_client_approver",
    defaultRecipients: ["agency_account_owner", "designated_client_approver"],
    automaticDelivery: false,
    clientCopyExcludes: ["provider_cost", "credit_margin", "agency_markup", "internal_prompts"],
    finalSendOwner: "agency_account_owner",
  },
  utm: {
    characterPolicy: "lowercase_ascii_kebab_case",
    preserveExistingQueryParameters: true,
    requireHttpsLandingPage: true,
    overwriteExistingUtmWithoutApproval: false,
    googleAds: {
      source: "google",
      medium: "cpc",
    },
    metaAds: {
      source: "meta",
      medium: "paid_social",
    },
    campaign: "campaign_slug",
    content: "asset_slug--variant_slug",
    term: "keyword_when_applicable",
  },
  advertising: {
    directPublishingAtLaunch: false,
    launchMode: "export_only",
    humanApprovalRequired: true,
    exportApprovalOwner: "agency_workspace_owner",
    policyApprovalOwner: "product_compliance_owner",
    disclaimerSource: "workspace_brand_policy_pack",
    unresolvedRequiredDisclaimer: "block_export",
    regulatedVerticalWithoutReview: "block_export",
    exportNotice: "Manual review and platform upload required.",
  },
  brandFidelity: {
    generateExactLogosOrTrademarkedText: false,
    compositeUploadedApprovedAssets: true,
    previewApprovalRequired: true,
  },
  engagementEthics: {
    darkPatternsAllowed: false,
    punitiveStreaksAllowed: false,
    engagementAsPrimarySuccessMetric: false,
    userControlledCadence: true,
  },
} as const;

export type ExternalApprovalStatus =
  | "not_started"
  | "evidence_ready"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "rejected";

export const EXTERNAL_PLATFORM_APPROVALS = {
  googleAds: {
    owner: "platform_integrations_owner",
    accountableOwner: "company_account_owner",
    status: "not_started" as ExternalApprovalStatus,
    requiredLevel: "developer_token_basic_or_higher",
    requiredAccount: "google_ads_manager_account",
    directPublishingEnabled: false,
    fallback: "google_rsa_export",
    evidence: [
      "manager_account_id",
      "developer_token_application_answers",
      "oauth_consent_screen_and_scopes",
      "privacy_policy_and_terms_urls",
      "product_walkthrough_recording",
      "test_account_export_sample",
      "submission_id_and_timestamp",
    ],
  },
  metaAds: {
    owner: "platform_integrations_owner",
    accountableOwner: "company_account_owner",
    status: "not_started" as ExternalApprovalStatus,
    requiredLevel: "business_verification_app_review_and_advanced_access",
    requiredAccount: "meta_business_manager",
    directPublishingEnabled: false,
    fallback: "meta_creative_pack_export",
    evidence: [
      "business_manager_id",
      "business_verification_documents",
      "app_review_permission_justification",
      "oauth_consent_screen_and_scopes",
      "privacy_policy_data_deletion_and_terms_urls",
      "product_walkthrough_recording",
      "test_business_export_sample",
      "submission_id_and_timestamp",
    ],
  },
} as const;

export type LaunchGateStatus = "pass" | "fail" | "not_measured" | "not_applicable";

export interface LaunchGateDefinition {
  id: string;
  name: string;
  owner: string;
  blockingFor: "all_launches" | "direct_publishing_only" | "post_launch_operating_review";
  measure: string;
  threshold: string;
  evidence: string;
}

export const LAUNCH_GATES: readonly LaunchGateDefinition[] = [
  {
    id: "ENG-01",
    name: "Type safety",
    owner: "engineering_owner",
    blockingFor: "all_launches",
    measure: "npm run check exit code",
    threshold: "0",
    evidence: "CI artifact from the release commit",
  },
  {
    id: "ENG-02",
    name: "Production build",
    owner: "engineering_owner",
    blockingFor: "all_launches",
    measure: "production build exit code",
    threshold: "0",
    evidence: "CI build log from the release commit",
  },
  {
    id: "SEC-01",
    name: "Tenant isolation",
    owner: "security_owner",
    blockingFor: "all_launches",
    measure: "cross-tenant read/write test failures",
    threshold: "0",
    evidence: "green tenant-isolation regression suite",
  },
  {
    id: "BILL-01",
    name: "Credit integrity",
    owner: "billing_owner",
    blockingFor: "all_launches",
    measure: "reserve/debit/release/idempotency regression failures",
    threshold: "0",
    evidence: "green billing and worker-restart suites",
  },
  {
    id: "OPS-01",
    name: "Restore readiness",
    owner: "operations_owner",
    blockingFor: "all_launches",
    measure: "age of successful production-like restore drill",
    threshold: "<= 30 days",
    evidence: "timestamped restore report and integrity checks",
  },
  {
    id: "OPS-02",
    name: "Observability",
    owner: "operations_owner",
    blockingFor: "all_launches",
    measure: "web, worker, queue, database, disk and error alerts tested",
    threshold: "100%",
    evidence: "alert test report with recipients and timestamps",
  },
  {
    id: "ADS-01",
    name: "Export package integrity",
    owner: "ads_product_owner",
    blockingFor: "all_launches",
    measure: "Google RSA and Meta pack contract-test failures",
    threshold: "0",
    evidence: "green export format and ZIP integrity suite",
  },
  {
    id: "ADS-02",
    name: "Ad policy and UTM readiness",
    owner: "product_compliance_owner",
    blockingFor: "all_launches",
    measure: "unresolved policy, disclaimer, landing URL, or UTM checks",
    threshold: "0",
    evidence: "export manifest and approval audit record",
  },
  {
    id: "ADS-03",
    name: "Google direct publishing approval",
    owner: "platform_integrations_owner",
    blockingFor: "direct_publishing_only",
    measure: "Google Ads approval status",
    threshold: "approved",
    evidence: "developer token approval and verified production scopes",
  },
  {
    id: "ADS-04",
    name: "Meta direct publishing approval",
    owner: "platform_integrations_owner",
    blockingFor: "direct_publishing_only",
    measure: "Meta approval status",
    threshold: "approved",
    evidence: "Business Verification, App Review, and Advanced Access approval",
  },
  {
    id: "BIZ-01",
    name: "Gross margin",
    owner: "finance_owner",
    blockingFor: "post_launch_operating_review",
    measure: "trailing-30-day gross margin per credit",
    threshold: ">= 75%",
    evidence: "provider-cost reconciliation and margin report",
  },
  {
    id: "BIZ-02",
    name: "Negative-margin workspaces",
    owner: "finance_owner",
    blockingFor: "post_launch_operating_review",
    measure: "share of active workspaces with negative trailing-30-day gross margin",
    threshold: "< 2%",
    evidence: "workspace economics report",
  },
] as const;