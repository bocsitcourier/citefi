import assert from "node:assert/strict";
import test from "node:test";

// The gate's production dependencies include a DB-backed reviewer, but this
// test invokes the real delivery boundary with injected, no-DB reviewers.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

const {
  assertArticleFinalizationQuality,
  FinalizationQualityGateError,
} = await import("../lib/generation-finalization-gate");

test("claim-review rejection cannot write COMPLETE at the final article boundary", async () => {
  let completedWrites = 0;
  let reviewCalls = 0;
  let policyCalls = 0;
  const content = `<article><h2>Audit guidance</h2><p>${
    Array.from({ length: 600 }, (_, index) => `word${index + 1}`).join(" ")
  }.</p></article>`;

  const completeAfterGate = async () => {
    await assertArticleFinalizationQuality(
      {
        teamId: 7,
        campaignId: 33,
        articleId: 44,
        content,
        targetWords: 600,
        outputOptions: { format: "html", minWords: 500, maxWords: 800 },
      },
      {
        reviewContent: async () => {
          reviewCalls += 1;
          return {
            passed: false,
            defects: [{ code: "factuality:unsupported_claim", evidence: "unverified result" }],
          };
        },
        loadBrandPolicy: async () => {
          policyCalls += 1;
          return {
            applicable: true,
            source: "campaign_snapshot",
            policy: {
              approvedClaims: [],
              prohibitedClaims: [],
              prohibitedPhrases: [],
              requiredDisclaimers: [],
              toneLexicon: { approved: [], offBrand: [] },
              localeConstraints: [],
            },
          };
        },
      },
    );
    completedWrites += 1;
  };

  await assert.rejects(completeAfterGate, (error: unknown) => {
    assert.ok(error instanceof FinalizationQualityGateError);
    assert.equal((error as { code?: string }).code, "QUALITY_GATE_FAILED");
    assert.match((error as Error).message, /unsupported_claim/);
    return true;
  });
  assert.equal(reviewCalls, 1, "the existing claim reviewer executed");
  assert.equal(policyCalls, 1, "the applicable immutable policy was executed");
  assert.equal(completedWrites, 0, "COMPLETE persistence is unreachable after rejection");
});