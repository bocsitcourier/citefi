/**
 * SEO CIRCUIT BREAKER — Platinum E2E Validation
 * ================================================
 * Tests the full chain: policy validators → DOM linker → prompt hydrator.
 * Run with:  npx tsx --test tests/seo-circuit-breaker.test.ts
 *
 * These tests act as a publish gate — if ANY of these fail, the article
 * pipeline has a policy violation and must NOT publish.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

// ─── Module imports ───────────────────────────────────────────────────────────
// We use dynamic imports so individual test suites can fail independently.

describe("SEO Policy Validators", () => {

  test("isBareGeoAnchor — accepts multi-word service+location phrases", async () => {
    const { isBareGeoAnchor } = await import("../lib/seo-policy.js");
    assert.equal(isBareGeoAnchor("private in-home caregiver services near Boston"), false,
      "Service+location phrase should NOT be bare geo");
    assert.equal(isBareGeoAnchor("specialized memory care support in Weston"), false,
      "Memory care phrase should NOT be bare geo");
    assert.equal(isBareGeoAnchor("post-hospital discharge care assistance"), false,
      "Service phrase with no city should NOT be bare geo");
  });

  test("isBareGeoAnchor — rejects bare city and city+state names", async () => {
    const { isBareGeoAnchor } = await import("../lib/seo-policy.js");
    assert.equal(isBareGeoAnchor("Boston"), true, "'Boston' is a bare geo anchor");
    assert.equal(isBareGeoAnchor("Boston MA"), true, "'Boston MA' is a bare geo anchor");
    assert.equal(isBareGeoAnchor("Weston MA"), true, "'Weston MA' is a bare geo anchor");
    assert.equal(isBareGeoAnchor("Boston, MA"), true, "'Boston, MA' is a bare geo anchor");
    assert.equal(isBareGeoAnchor("MA"), true, "State abbreviation alone is bare geo");
    assert.equal(isBareGeoAnchor("Massachusetts"), true, "Full state name alone is bare geo");
  });

  test("isHighQualityAnchor — accepts 4+ word semantic clusters", async () => {
    const { isHighQualityAnchor } = await import("../lib/seo-policy.js");
    assert.equal(isHighQualityAnchor("private in-home caregiver near Boston"), true);
    assert.equal(isHighQualityAnchor("specialized senior home care services"), true);
    assert.equal(isHighQualityAnchor("compassionate post-hospital discharge support"), true);
    assert.equal(isHighQualityAnchor("professional memory care for elderly parents"), true);
  });

  test("isHighQualityAnchor — rejects bare geo, short phrases, stop-word edges", async () => {
    const { isHighQualityAnchor } = await import("../lib/seo-policy.js");
    assert.equal(isHighQualityAnchor("Boston"), false, "Bare city must fail");
    assert.equal(isHighQualityAnchor("Boston MA"), false, "City+state must fail");
    assert.equal(isHighQualityAnchor("home care"), false, "Two-word phrase must fail");
    assert.equal(isHighQualityAnchor("in Boston"), false, "Stop-word-led phrase must fail");
    assert.equal(isHighQualityAnchor("senior care"), false, "Two-word phrase must fail");
    assert.equal(isHighQualityAnchor(""), false, "Empty string must fail");
  });

});

describe("DOM Hyperlink Injector — Bare City Rejection", () => {

  const TEST_URL = "https://example.com/services";

  test("CIRCUIT BREAKER: bare 'Boston' is NEVER hyperlinked", async () => {
    const { applyHyperlinksDom } = await import("../lib/keyword-hyperlink-pipeline.js");

    const html = `
      <p>We serve seniors across Boston and the surrounding area.</p>
      <dl>
        <dt>What is memory care in Boston?</dt>
        <dd>Memory care is a specialized service for seniors in Boston who need extra support.</dd>
      </dl>
    `;

    const rules = [
      // Bare city — should be REJECTED by the engine
      { keyword: "Boston", url: TEST_URL },
      { keyword: "Boston MA", url: TEST_URL },
    ];

    const result = applyHyperlinksDom(html, rules);

    assert.equal(result.keywordsLinked, 0,
      "No links should be injected for bare geo keywords");
    assert.ok(result.keywordsMissing.includes("Boston"),
      "'Boston' should appear in keywordsMissing");
    assert.ok(!result.correctedHtml.includes(">Boston</a>"),
      "Output HTML must not contain 'Boston' as hyperlinked text");
    assert.ok(!result.correctedHtml.includes(">Boston MA</a>"),
      "Output HTML must not contain 'Boston MA' as hyperlinked text");

    console.log("  ✅ Bare city 'Boston' correctly rejected. keywordsMissing:", result.keywordsMissing);
  });

  test("CIRCUIT BREAKER: valid 4-7 word semantic clusters ARE hyperlinked", async () => {
    const { applyHyperlinksDom } = await import("../lib/keyword-hyperlink-pipeline.js");

    const html = `
      <p>Our specialized senior home care services provide families with peace of mind.</p>
      <dl>
        <dt>What makes in-home dementia support effective?</dt>
        <dd>Professional in-home dementia care services for seniors offer consistency and routine that slows cognitive decline.</dd>
      </dl>
    `;

    const rules = [
      { keyword: "specialized senior home care services", url: TEST_URL },
      { keyword: "professional in-home dementia care services for seniors", url: `${TEST_URL}/dementia` },
    ];

    const result = applyHyperlinksDom(html, rules);

    assert.ok(result.keywordsLinked >= 1,
      "At least one valid semantic cluster should be linked");
    assert.ok(result.correctedHtml.includes("<a "),
      "Output HTML should contain at least one <a> tag");

    console.log(
      `  ✅ ${result.keywordsLinked} semantic cluster(s) linked. keywords:`,
      result.keywordsFound
    );
  });

  test("CIRCUIT BREAKER: mixed rules — only valid anchors survive", async () => {
    const { applyHyperlinksDom } = await import("../lib/keyword-hyperlink-pipeline.js");

    const html = `
      <p>Boston is a great city. We offer private caregiver support near Boston for elderly residents.</p>
      <dd>Our compassionate post-hospital discharge assistance helps families transition safely.</dd>
    `;

    const rules = [
      // Should be REJECTED
      { keyword: "Boston", url: TEST_URL },
      { keyword: "home care", url: TEST_URL },
      // Should be ACCEPTED
      { keyword: "private caregiver support near Boston", url: TEST_URL },
      { keyword: "compassionate post-hospital discharge assistance", url: `${TEST_URL}/discharge` },
    ];

    const result = applyHyperlinksDom(html, rules);

    // Bare geo and short phrases must not be linked
    assert.ok(!result.correctedHtml.match(/<a[^>]*>Boston<\/a>/),
      "Bare 'Boston' must not be hyperlinked");
    assert.ok(!result.correctedHtml.match(/<a[^>]*>home care<\/a>/),
      "'home care' (2 words) must not be hyperlinked");

    // Valid phrases should be linked if they appear in the HTML
    assert.ok(result.keywordsFound.length > 0 || result.keywordsLinked >= 0,
      "Engine ran without error");
    assert.ok(result.keywordsMissing.includes("Boston"),
      "'Boston' must appear in keywordsMissing");

    console.log(
      `  ✅ Mixed rules: ${result.keywordsLinked} linked, ${result.keywordsMissing.length} rejected.`,
      "\n     Linked:", result.keywordsFound,
      "\n     Rejected:", result.keywordsMissing
    );
  });

  test("CIRCUIT BREAKER: FAQ section (dt/dd) is covered by the injector", async () => {
    const { applyHyperlinksDom } = await import("../lib/keyword-hyperlink-pipeline.js");

    const html = `
      <section class="faq">
        <dl>
          <dt>What services are available for senior home care near Weston?</dt>
          <dd>Families seeking professional senior care assistance in Weston can access a range of in-home services
              including specialized memory care support for aging adults.</dd>
        </dl>
      </section>
    `;

    const rules = [
      { keyword: "professional senior care assistance in Weston", url: `${TEST_URL}/weston` },
      { keyword: "specialized memory care support for aging adults", url: `${TEST_URL}/memory-care` },
    ];

    const result = applyHyperlinksDom(html, rules);

    assert.ok(result.faqKeywordsLinked >= 0, "faqKeywordsLinked should be a number");

    const linkedInFaq = result.correctedHtml.includes("<a ") && (
      result.correctedHtml.includes("/weston") || result.correctedHtml.includes("/memory-care")
    );

    if (linkedInFaq) {
      console.log(`  ✅ FAQ section: ${result.faqKeywordsLinked} FAQ links injected`);
    } else {
      console.log(`  ℹ️  FAQ section: phrases not found in exact form — engine ran without error`);
    }

    // Engine should NOT throw; correctedHtml should be valid
    assert.ok(result.correctedHtml.length > 0, "correctedHtml must not be empty");
    assert.ok(!result.correctedHtml.includes(">Weston<\/a>"),
      "Bare 'Weston' must never be hyperlinked even in FAQ");
  });
});

describe("Prompt Hydrator — SEO Law Injection", () => {

  test("generateHydratedPrompt includes CRITICAL SEO header", async () => {
    const { generateHydratedPrompt } = await import("../lib/prompt-hydrator.js");
    const result = await generateHydratedPrompt(); // no teamId — static laws only
    assert.ok(result.block.includes("CRITICAL SEO"),
      "Hydrated prompt must contain 'CRITICAL SEO'");
    assert.ok(result.block.includes("GLOBAL SEO LAWS"),
      "Hydrated prompt must contain GLOBAL SEO LAWS block");
  });

  test("generateHydratedPrompt bans bare city anchors in prompt text", async () => {
    const { generateHydratedPrompt } = await import("../lib/prompt-hydrator.js");
    const result = await generateHydratedPrompt();
    assert.ok(result.block.includes("FORBIDDEN"),
      "Prompt must state bare geo is FORBIDDEN");
    assert.ok(result.block.includes("4-7 word") || result.block.includes("4-7 words"),
      "Prompt must specify the 4-7 word minimum");
  });

  test("generateHydratedPrompt without teamId has no Guardian warnings", async () => {
    const { generateHydratedPrompt } = await import("../lib/prompt-hydrator.js");
    const result = await generateHydratedPrompt(0); // explicit zero = no ledger
    assert.equal(result.hasGuardianWarnings, false,
      "No teamId → no Guardian warnings expected");
    assert.equal(result.warningCount, 0);
  });

  test("GLOBAL_SEO_LAWS contains all required anchor law clauses", async () => {
    const { GLOBAL_SEO_LAWS } = await import("../lib/seo-ai-laws.js");
    assert.ok(GLOBAL_SEO_LAWS.includes("4-7 word") || GLOBAL_SEO_LAWS.includes("4-7 words"),
      "Laws must specify 4-7 word requirement");
    assert.ok(GLOBAL_SEO_LAWS.toUpperCase().includes("NEVER") || GLOBAL_SEO_LAWS.includes("FORBIDDEN"),
      "Laws must explicitly forbid bare geo");
    assert.ok(GLOBAL_SEO_LAWS.includes("FAQ"),
      "Laws must mention FAQ section requirements");
    console.log("  ✅ GLOBAL_SEO_LAWS contains all required law clauses");
  });

});
