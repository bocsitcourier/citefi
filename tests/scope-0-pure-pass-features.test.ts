/**
 * Scope 0 pure-function locks for campaign brand confirmation and standalone
 * Brand Intelligence. These tests do not call a provider, route, queue, or
 * database; they exercise the production normalization/validation functions
 * directly.
 *
 * Run:
 *   node --env-file=.env.local --import tsx/esm --test \
 *     tests/scope-0-pure-pass-features.test.ts
 */
import assert from "node:assert/strict";
import test from "node:test";

test("campaign brand confirmation helpers normalize matching URLs and statuses", async () => {
  const {
    profileStatusToBrandStatus,
    sameCampaignBusinessUrl,
    toResearchStatus,
  } = await import("../lib/campaign-service.js");

  assert.equal(
    sameCampaignBusinessUrl(
      "https://www.Example.com/services/",
      "https://example.com/services",
    ),
    true,
  );
  assert.equal(
    sameCampaignBusinessUrl("https://example.com/services", "https://other.test/services"),
    false,
  );
  assert.equal(sameCampaignBusinessUrl(null, "https://example.com"), false);
  assert.equal(profileStatusToBrandStatus("complete"), "ready");
  assert.equal(profileStatusToBrandStatus("running"), "researching");
  assert.equal(profileStatusToBrandStatus("unknown"), null);
  assert.equal(toResearchStatus("confirmed"), "confirmed");
  assert.equal(toResearchStatus("missing"), "not_started");
});

test("standalone Brand Intelligence validation keeps source claims and manual overrides grounded", async () => {
  const { criticalProfileIssues, retainSourceSupportedClaims } =
    await import("../lib/brand-intelligence-validation.js");
  const { mergeProfileWithOverrides } =
    await import("../lib/client-brand-profile-service.js");

  const profile: any = {
    brandVoice: { toneAdjectives: ["clear"], brandValues: ["care"] },
    positioning: {
      uniqueValueProposition: "Fixture value",
      coreServices: [{ name: "Audits" }],
    },
    targetAudience: { primaryPersona: "Austin homeowners" },
    competitiveGaps: { opportunityTopics: ["fixture topic"] },
    failureAnalysis: { likelyLossReasons: ["fixture reason"] },
    contentOpportunities: { uncoveredTopics: ["fixture opportunity"] },
    brandPolicyPack: {
      prohibitedClaims: ["unsupported guarantee"],
      prohibitedPhrases: [],
      toneLexicon: { approved: ["clear"], offBrand: [] },
    },
  };
  assert.deepEqual(
    criticalProfileIssues(profile, "Fixture Services provides home energy audits."),
    [],
  );

  const claims = retainSourceSupportedClaims(
    ["Home energy audits", "Guaranteed savings"],
    "Fixture Services provides home energy audits.",
  );
  assert.deepEqual(claims.approved, ["Home energy audits"]);
  assert.deepEqual(claims.rejected, ["Guaranteed savings"]);

  const merged = mergeProfileWithOverrides(profile, {
    brandVoice: { toneAdjectives: ["direct"] },
    positioning: { uniqueValueProposition: "Manual fixture value" },
  } as any);
  assert.deepEqual(merged.brandVoice.toneAdjectives, ["direct"]);
  assert.equal(merged.positioning.uniqueValueProposition, "Manual fixture value");
  assert.deepEqual(profile.brandVoice.toneAdjectives, ["clear"]);

  const rejected = criticalProfileIssues({}, "");
  assert.ok(rejected.includes("required business website could not be fetched or analyzed"));
  assert.ok(rejected.includes("brand voice is missing"));
  assert.ok(rejected.includes("positioning is missing"));
  assert.ok(rejected.includes("brand policy analysis is missing"));
});