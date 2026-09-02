import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdTrackingUrl,
  buildAdExportRowsFromManifest,
  deterministicPolicyCheck,
  validateGoogleRsa,
  validateLandingUrl,
  validateMetaPack,
  assertApprovalAuthority,
} from "../../lib/campaign-ads-service.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Ads approval RBAC enforces client, compliance, export, and separation authorities", () => {
  const base = {
    actorUserId: 7, agencyTeamId: 10, clientTeamId: 11,
    clientParentTeamId: 10, designatedApproverUserId: 7,
  };
  assert.doesNotThrow(() => assertApprovalAuthority({
    ...base, approvalType: "client", clientMembershipRole: "client_viewer",
  }));
  assert.throws(() => assertApprovalAuthority({
    ...base, approvalType: "client", actorUserId: 8, clientMembershipRole: "admin",
  }), /designated approver/);
  assert.throws(() => assertApprovalAuthority({
    ...base, approvalType: "client", clientParentTeamId: 99, clientMembershipRole: "client_viewer",
  }), /relationship/);
  assert.doesNotThrow(() => assertApprovalAuthority({
    ...base, approvalType: "policy", globalRole: "compliance",
  }));
  assert.throws(() => assertApprovalAuthority({
    ...base, approvalType: "policy", globalRole: "team_member", agencyMembershipRole: "owner",
  }), /Compliance/);
  assert.doesNotThrow(() => assertApprovalAuthority({
    ...base, approvalType: "export", agencyMembershipRole: "owner",
  }));
  assert.throws(() => assertApprovalAuthority({
    ...base, approvalType: "export", agencyMembershipRole: "member",
  }), /owner or admin/);
  assert.throws(() => assertApprovalAuthority({
    ...base, approvalType: "export", agencyMembershipRole: "admin",
    previouslyApprovedTypes: [{ actorUserId: 7, approvalType: "policy" }],
  }), /separation/);
});

test("concurrent cross-type approvals cannot let one actor win twice", async () => {
  // Model the database row lock: each contender evaluates its authorization
  // against the history only after the prior contender has appended.
  const approvals: Array<{ actorUserId: number; approvalType: string }> = [];
  let tail = Promise.resolve();
  const approveUnderAdLock = (approvalType: "client" | "policy") => {
    const attempt = tail.then(() => {
      assertApprovalAuthority({
        approvalType, actorUserId: 7, agencyTeamId: 10, clientTeamId: 11,
        clientParentTeamId: 10, designatedApproverUserId: 7,
        clientMembershipRole: "client_viewer", globalRole: "compliance",
        previouslyApprovedTypes: approvals,
      });
      approvals.push({ actorUserId: 7, approvalType });
    });
    tail = attempt.catch(() => undefined);
    return attempt;
  };
  const results = await Promise.allSettled([
    approveUnderAdLock("client"),
    approveUnderAdLock("policy"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(approvals.length, 1);

  const source = readFileSync(resolve(import.meta.dirname, "../../lib/campaign-ads-service.ts"), "utf8");
  assert.match(source, /db\.transaction\(async \(tx\)/);
  assert.match(source, /\.limit\(1\)\.for\("update"\)/);
});

test("client approval route accepts a client reviewer without agency membership", () => {
  const route = readFileSync("app/api/campaigns/[id]/ads/[adId]/approve/route.ts", "utf8");
  const campaignService = readFileSync("lib/campaign-service.ts", "utf8");
  assert.match(route, /requireClientReviewer/);
  assert.match(route, /getCampaignForClientApprovalByPublicId/);
  assert.match(route, /approveCampaignAd\(campaign\.teamId/);
  assert.match(campaignService, /eq\(campaigns\.clientTeamId, clientTeamId\)/);
  assert.match(campaignService, /isNull\(teams\.deletedAt\)/);
  assert.match(campaignService, /eq\(teams\.clientStatus, "active"\)/);
  assert.match(campaignService, /campaign client approval relationship lookup/);
  const auth = readFileSync("lib/api/auth.ts", "utf8");
  assert.match(auth, /requireClientReviewer[\s\S]*isNull\(teams\.deletedAt\)[\s\S]*eq\(teams\.clientStatus, "active"\)/);
  const adsService = readFileSync("lib/campaign-ads-service.ts", "utf8");
  assert.match(adsService, /clientDeletedAt[\s\S]*clientStatus[\s\S]*Client team relationship is not active/);
});

test("locked UTM convention is deterministic and preserves non-UTM query parameters", () => {
  const url = buildAdTrackingUrl({
    landingUrl: "https://example.com/book?ref=partner",
    platform: "google",
    campaign: "Phoenix Summer 2026",
    asset: "Search Ad",
    variant: "A",
    keyword: "Emergency Plumbing",
  });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("ref"), "partner");
  assert.equal(parsed.searchParams.get("utm_source"), "google");
  assert.equal(parsed.searchParams.get("utm_medium"), "cpc");
  assert.equal(parsed.searchParams.get("utm_campaign"), "phoenix-summer-2026");
  assert.equal(parsed.searchParams.get("utm_content"), "search-ad--a");
  assert.equal(parsed.searchParams.get("utm_term"), "emergency-plumbing");
  assert.throws(() => buildAdTrackingUrl({
    landingUrl: "https://example.com/?utm_source=legacy",
    platform: "meta", campaign: "Campaign", asset: "Creative", variant: "1",
  }), /explicit overwrite approval/);
});

test("landing alignment is HTTPS, same-domain, and SSRF-safe without fetching", () => {
  assert.equal(validateLandingUrl("https://offers.example.com/book", "https://example.com").hostname, "offers.example.com");
  assert.throws(() => validateLandingUrl("http://example.com", "https://example.com"), /HTTPS/);
  assert.throws(() => validateLandingUrl("https://127.0.0.1/admin", "https://127.0.0.1"), /not allowed/);
  assert.throws(() => validateLandingUrl("https://evil.test", "https://example.com"), /does not align/);
});

test("Google RSA and Meta creative limits are deterministic", () => {
  assert.equal(validateGoogleRsa({
    headlines: ["Fast Local Help", "Book Today", "Trusted Service"],
    descriptions: ["Book reliable local service today.", "Talk with our local team."],
  }).length, 0);
  assert.ok(validateGoogleRsa({
    headlines: ["x".repeat(31)], descriptions: ["only one"],
  }).some((i) => i.severity === "error"));
  assert.equal(validateMetaPack({ variants: [1, 2, 3].map((n) => ({
    name: `v${n}`, primaryText: "Local help when you need it.", headline: "Book local help",
    callToAction: "LEARN_MORE", imageBrief: "A real local team at work, with no logos or text",
  })) }).filter((i) => i.severity === "error").length, 0);
});

test("policy gate blocks prohibited claims and unresolved required disclaimers", () => {
  const google = {
    headlines: ["Guaranteed Best", "Book Today", "Local Team"],
    descriptions: ["Fast service.", "Call today."],
  };
  const meta = { variants: [1, 2, 3].map((n) => ({
    name: `v${n}`, primaryText: "Fast service.", headline: "Call today",
    callToAction: "CALL_NOW", imageBrief: "Local scene",
  })) };
  const result = deterministicPolicyCheck(google, meta, {
    brandPolicyPack: { prohibitedPhrases: ["guaranteed best"], requiredDisclaimers: ["Terms apply."] },
  });
  assert.equal(result.blocksExport, true);
  assert.deepEqual(result.prohibitedMatches, ["guaranteed best"]);
  assert.deepEqual(result.unresolvedDisclaimers, ["Terms apply."]);
});

test("export rows are derived only from the immutable finalized manifest", () => {
  const manifest = {
    schemaVersion: "campaign-ads-export/v1",
    campaignSlug: "manifest-campaign",
    landingUrl: "https://example.com/book?ref=manifest",
    google: {
      headlines: ["Fast Local Help", "Book Today", "Trusted Service"],
      descriptions: ["Book reliable local service today.", "Talk with our local team."],
      keywords: ["Emergency Plumbing"],
    },
    meta: {
      variants: [{ name: "trust", primaryText: "Local help.", headline: "Book local help" }],
    },
  };
  const { googleRows, metaRows } = buildAdExportRowsFromManifest(manifest);
  assert.match(googleRows[0].finalUrl, /ref=manifest/);
  assert.match(googleRows[0].finalUrl, /utm_campaign=manifest-campaign/);
  assert.match(metaRows[0].destinationUrl, /utm_source=meta/);
  assert.throws(() => buildAdExportRowsFromManifest({}), /manifest is invalid/);
});