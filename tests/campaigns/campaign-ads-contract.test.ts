import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdTrackingUrl,
  buildAdExportRowsFromManifest,
  deterministicPolicyCheck,
  validateGoogleRsa,
  validateLandingUrl,
  validateMetaPack,
} from "../../lib/campaign-ads-service.js";

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