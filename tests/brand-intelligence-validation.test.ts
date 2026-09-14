import assert from "node:assert/strict";
import test from "node:test";
import {
  criticalProfileIssues,
  parseSingleStructuredObject,
  retainSourceSupportedClaims,
} from "../lib/brand-intelligence-validation";

test("structured responses reject truncation and multiple JSON objects", () => {
  assert.throws(() => parseSingleStructuredObject('{"competitiveGaps": {}'), /truncated/);
  assert.throws(() => parseSingleStructuredObject('{"competitiveGaps": {}} {"failureAnalysis": {}}'), /trailing|multiple/);
  assert.deepEqual(parseSingleStructuredObject('```json\n{"competitiveGaps": {}}\n```'), { competitiveGaps: {} });
});

test("source failure and missing analyses cannot qualify as complete", () => {
  const issues = criticalProfileIssues({
    brandVoice: { toneAdjectives: [] },
    positioning: { uniqueValueProposition: "", coreServices: [] },
    targetAudience: { primaryPersona: "" },
    competitiveGaps: { opportunityTopics: [] },
    failureAnalysis: { likelyLossReasons: [] },
    contentOpportunities: { uncoveredTopics: [] },
  }, "");
  assert.ok(issues.some(issue => issue.includes("website")));
  assert.ok(issues.some(issue => issue.includes("brand voice")));
  assert.ok(issues.some(issue => issue.includes("gap analysis")));
});

test("fabricated approved claims are rejected while source quotes survive", () => {
  const result = retainSourceSupportedClaims(
    ["BPI certified", "10-year warranty", "Home energy assessments"],
    "Services include home energy assessments and insulation consultations."
  );
  assert.deepEqual(result.approved, ["Home energy assessments"]);
  assert.deepEqual(result.rejected, ["BPI certified", "10-year warranty"]);
});