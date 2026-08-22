import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ANNUAL_BILLING_CHARGED_MONTHS,
  BILLING_PLANS,
  getAnnualPriceUsd,
  SELF_SERVE_PLAN_IDS,
  TOP_UPS,
} from "../../lib/billing/plans";
import { CREDIT_MENU } from "../../lib/credit-menu";
import {
  COMMERCIAL_LAUNCH_DEFAULTS,
  EXTERNAL_PLATFORM_APPROVALS,
  LAUNCH_GATES,
  LAUNCH_POLICY_VERSION,
  PRODUCT_POLICY_DEFAULTS,
} from "../../lib/launch-governance";
import {
  CREDIT_ANCHORS,
  evaluateMarginCertification,
  hasKnownProviderRate,
  PLAN_CREDIT_VALUE_USD,
} from "../../lib/cost-telemetry";

test("commercial launch defaults match the runtime billing catalog", () => {
  assert.equal(LAUNCH_POLICY_VERSION, "2026-08-22");
  assert.equal(ANNUAL_BILLING_CHARGED_MONTHS, 10);

  for (const plan of Object.values(BILLING_PLANS)) {
    assert.equal(getAnnualPriceUsd(plan), plan.priceUsd * 10);
    assert.equal(
      PLAN_CREDIT_VALUE_USD[plan.id],
      plan.monthlyCredits > 0 ? plan.priceUsd / plan.monthlyCredits : 0
    );
  }

  assert.equal(BILLING_PLANS.free.monthlyCredits, COMMERCIAL_LAUNCH_DEFAULTS.freeTier.credits);
  assert.equal(BILLING_PLANS.free.maxSeats, COMMERCIAL_LAUNCH_DEFAULTS.freeTier.maxSeats);
  assert.equal(BILLING_PLANS.agency.monthlyCredits, 1_000);
  assert.equal(BILLING_PLANS.agency.maxClientWorkspaces, 25);
  assert.ok(SELF_SERVE_PLAN_IDS.includes("agency"));
  assert.equal(BILLING_PLANS.enterprise.salesAssisted, true);
  assert.equal(COMMERCIAL_LAUNCH_DEFAULTS.agencyRebilling.pooledCredits, false);
  assert.equal(COMMERCIAL_LAUNCH_DEFAULTS.agencyRebilling.citefiInvoicesAgencyClients, false);
  assert.ok(TOP_UPS.every((topUp) => topUp.credits > 0 && topUp.priceUsd > 0));
});

test("cost telemetry uses the canonical credit menu and locked margin thresholds", () => {
  assert.equal(CREDIT_ANCHORS.article, CREDIT_MENU.article);
  assert.equal(CREDIT_ANCHORS.video, CREDIT_MENU.video);
  assert.equal(CREDIT_ANCHORS.podcast, CREDIT_MENU.podcast);
  assert.equal(CREDIT_ANCHORS.social, CREDIT_MENU.social_batch);
  assert.equal(COMMERCIAL_LAUNCH_DEFAULTS.marginPolicy.minimumGrossMarginPctPerCredit, 75);
  assert.equal(COMMERCIAL_LAUNCH_DEFAULTS.marginPolicy.maximumNegativeMarginWorkspacePct, 2);
  assert.equal(
    COMMERCIAL_LAUNCH_DEFAULTS.providerCostPolicy.unknownOrZeroPricedModel,
    "blocks_margin_certification"
  );
  assert.equal(hasKnownProviderRate("article_generation", "gemini-2.5-flash"), true);
  assert.equal(hasKnownProviderRate("article_generation", "unknown-future-model"), false);
  assert.equal(hasKnownProviderRate("podcast_tts", "gpt-4o-mini-tts"), true);
});

test("margin certification fails closed on missing evidence", () => {
  const complete = evaluateMarginCertification({
    composition: [{ op: "article_generation", weight: 2 }],
    p90CostMicrousdByOperation: { article_generation: 25_000 },
    successfulSamplesByOperation: { article_generation: 100 },
    unpricedModelsByOperation: {},
    minimumSuccessfulSamples: 100,
    invoiceReconciliationRecorded: true,
  });
  assert.equal(complete.certificationReady, true);
  assert.equal(complete.p90CostMicrousd, 50_000);

  const blocked = evaluateMarginCertification({
    composition: [
      { op: "article_generation", weight: 1 },
      { op: "article_review", weight: 1 },
    ],
    p90CostMicrousdByOperation: { article_generation: 25_000 },
    successfulSamplesByOperation: { article_generation: 99 },
    unpricedModelsByOperation: {
      article_generation: ["gemini/unknown-future-model"],
    },
    minimumSuccessfulSamples: 100,
    invoiceReconciliationRecorded: false,
  });
  assert.equal(blocked.certificationReady, false);
  assert.ok(blocked.blockers.includes("missing:article_review"));
  assert.ok(blocked.blockers.includes("insufficient_samples:article_generation"));
  assert.ok(blocked.blockers.includes("unpriced:gemini/unknown-future-model"));
  assert.ok(blocked.blockers.includes("invoice_reconciliation_not_recorded"));
});

test("external approvals cannot silently enable direct publishing", () => {
  for (const approval of Object.values(EXTERNAL_PLATFORM_APPROVALS)) {
    assert.equal(approval.status, "not_started");
    assert.equal(approval.directPublishingEnabled, false);
    assert.ok(approval.owner.length > 0);
    assert.ok(approval.accountableOwner.length > 0);
    assert.ok(approval.evidence.length >= 7);
    assert.ok(approval.fallback.endsWith("_export"));
  }

  assert.equal(PRODUCT_POLICY_DEFAULTS.advertising.launchMode, "export_only");
  assert.equal(PRODUCT_POLICY_DEFAULTS.advertising.directPublishingAtLaunch, false);
  assert.equal(PRODUCT_POLICY_DEFAULTS.advertising.unresolvedRequiredDisclaimer, "block_export");
});

test("launch gates are unique, owned, measurable, and preserve export-only fallback", () => {
  const ids = new Set<string>();
  for (const gate of LAUNCH_GATES) {
    assert.ok(!ids.has(gate.id), `duplicate launch gate ${gate.id}`);
    ids.add(gate.id);
    assert.ok(gate.owner.length > 0);
    assert.ok(gate.measure.length > 0);
    assert.ok(gate.threshold.length > 0);
    assert.ok(gate.evidence.length > 0);
  }

  const directOnly = LAUNCH_GATES.filter((gate) => gate.blockingFor === "direct_publishing_only");
  assert.deepEqual(
    directOnly.map((gate) => gate.id).sort(),
    ["ADS-03", "ADS-04"]
  );
});

test("UTM and report ownership defaults are explicit", () => {
  assert.equal(PRODUCT_POLICY_DEFAULTS.utm.googleAds.source, "google");
  assert.equal(PRODUCT_POLICY_DEFAULTS.utm.googleAds.medium, "cpc");
  assert.equal(PRODUCT_POLICY_DEFAULTS.utm.metaAds.source, "meta");
  assert.equal(PRODUCT_POLICY_DEFAULTS.utm.metaAds.medium, "paid_social");
  assert.equal(PRODUCT_POLICY_DEFAULTS.reports.recordOwner, "agency_workspace");
  assert.equal(PRODUCT_POLICY_DEFAULTS.reports.finalSendOwner, "agency_account_owner");
  assert.equal(PRODUCT_POLICY_DEFAULTS.reports.automaticDelivery, false);
});

test("public metadata does not claim the deferred one-URL campaign workflow", () => {
  const layoutSource = readFileSync(
    new URL("../../app/layout.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(layoutSource, /Create complete local marketing campaigns from one business URL/i);
  assert.match(layoutSource, /Local SEO Content Platform for Agencies/i);
});