import assert from "node:assert/strict";
import test from "node:test";

process.env.GEMINI_API_KEY ??= "contract-regression-no-provider-call";

const {
  VideoScriptContractError,
  parseVideoScriptResponse,
} = await import("../../lib/gemini-video-script-generator");
const {
  ExpandedVideoConceptContractError,
  parseExpandedVideoConceptResponse,
} = await import("../../lib/veo-idea-expander");
const { parseVideoStyleAnalysisResponse } = await import(
  "../../lib/video-style-analyzer"
);
const { redactProviderError, redactProviderOutput } = await import(
  "../../lib/provider-diagnostics"
);

function completeFiveSceneScript() {
  return {
    title: "A practical local energy checklist",
    totalDuration: 60,
    scenes: [10, 12, 12, 12, 14].map((targetDuration, index) => ({
      sceneNumber: index + 1,
      timeRange: `${[0, 10, 22, 34, 46][index]}-${[10, 22, 34, 46, 60][index]}s`,
      targetDuration,
      narration: "A concise educational narration for this scene.",
      visualDescription: "A specific cinematic local scene with natural movement.",
      caption: "Practical local insight",
      geoReference: "A local neighborhood reference",
      seoKeywords: ["local", "education"],
    })),
    hashtags: ["#LocalEnergy"],
    callToAction: "Learn more about this topic",
    companyName: "Harbor Home Energy",
    location: "Boston",
  };
}

test("video parser accepts the bounded five-scene contract without provider calls", () => {
  const answer = JSON.stringify(completeFiveSceneScript());
  const parsed = parseVideoScriptResponse({
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { thought: true, text: "Hidden thought must not be parsed." },
            { text: answer },
          ],
        },
      },
    ],
  });
  assert.equal(parsed.scenes.length, 5);
  assert.equal(parsed.scenes[4]?.targetDuration, 14);
});

test("video parser rejects incomplete/oversized provider output without repair", () => {
  const answer = JSON.stringify(completeFiveSceneScript());
  assert.throws(
    () =>
      parseVideoScriptResponse({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: answer.slice(0, -10) }] },
          },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof VideoScriptContractError);
      assert.match(error.message, /MAX_TOKENS|incomplete/i);
      return true;
    },
  );

  assert.throws(
    () =>
      parseVideoScriptResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: answer.slice(0, -10) }] },
          },
        ],
      }),
    /malformed or truncated/i,
  );
});

test("provider diagnostics contain hashes/lengths but never provider text", () => {
  const secretOutput = "customer narration that must never be logged";
  const outputDiagnostic = redactProviderOutput(secretOutput, "video_parser");
  const errorDiagnostic = redactProviderError(
    new Error(secretOutput),
    secretOutput,
    "video_parser",
  );

  assert.doesNotMatch(outputDiagnostic, /customer narration|must never be logged/);
  assert.doesNotMatch(errorDiagnostic, /customer narration|must never be logged/);
  assert.match(outputDiagnostic, /outputSha256=[a-f0-9]{64}/);
  assert.match(outputDiagnostic, /outputLength=\d+/);
  assert.match(errorDiagnostic, /errorSha256=[a-f0-9]{64}/);
});

function completeExpandedConcept() {
  return {
    hook: {
      description: "A focused opening challenge.",
      visualConcept: "A close-up of a person recognizing the problem.",
      emotionalTrigger: "Curiosity",
    },
    problem: {
      description: "The audience faces a familiar obstacle.",
      painPoints: ["Time pressure", "Unclear choices"],
      relatableScenario: "A customer compares options before making a decision.",
    },
    solution: {
      description: "The service provides a clear next step.",
      keyFeatures: ["Guided planning", "Expert support"],
      differentiator: "A practical, transparent experience.",
    },
    benefits: {
      description: "The customer gains confidence and momentum.",
      outcomes: ["Less uncertainty", "Faster progress"],
      transformation: "From hesitation to an informed next step.",
    },
    proof: {
      description: "Credibility is shown through practical evidence.",
      socialProof: "Customers describe a smoother process.",
      credibilityElement: "Experienced local specialists.",
    },
    cta: {
      description: "The close invites a clear action.",
      actionPhrase: "Learn more today",
      urgencyElement: "Start with a helpful consultation.",
    },
    overallNarrative: "A customer moves from uncertainty to confident action.",
    targetEmotion: "Confidence",
  };
}

test("idea expansion parser rejects incomplete and oversized valid concepts", () => {
  const incomplete = completeExpandedConcept();
  delete (incomplete as { proof?: unknown }).proof;
  assert.throws(
    () =>
      parseExpandedVideoConceptResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(incomplete) }] },
          },
        ],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExpandedVideoConceptContractError);
      assert.match(error.message, /complete bounded field contract/i);
      return true;
    },
  );

  const oversized = completeExpandedConcept();
  oversized.hook.description = "x".repeat(50_001);
  assert.throws(
    () =>
      parseExpandedVideoConceptResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(oversized) }] },
          },
        ],
      }),
    /exceeds 50000/i,
  );
  assert.throws(
    () =>
      parseExpandedVideoConceptResponse({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: JSON.stringify(completeExpandedConcept()) }] },
          },
        ],
      }),
    /MAX_TOKENS|incomplete/i,
  );
});

function completeStyleAnalysis() {
  return {
    styleDescription: "Warm, cinematic documentary styling with clean compositions.",
    stylePrompt: "Warm natural light, gentle camera movement, and balanced compositions.",
    colorPalette: "Warm amber highlights with neutral shadows.",
    cameraWork: "Slow dolly moves and steady eye-level framing.",
    mood: "Cinematic and welcoming",
    editingStyle: "Clean cuts with occasional soft transitions.",
  };
}

test("video style parser rejects incomplete and oversized valid style JSON", () => {
  const incomplete = completeStyleAnalysis();
  delete (incomplete as { mood?: unknown }).mood;
  assert.throws(
    () =>
      parseVideoStyleAnalysisResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(incomplete) }] },
          },
        ],
      }),
    /complete bounded field contract/i,
  );

  const oversized = completeStyleAnalysis();
  oversized.stylePrompt = "x".repeat(50_001);
  assert.throws(
    () =>
      parseVideoStyleAnalysisResponse({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(oversized) }] },
          },
        ],
      }),
    /exceeds 50000/i,
  );
  assert.throws(
    () =>
      parseVideoStyleAnalysisResponse({
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: JSON.stringify(completeStyleAnalysis()) }] },
          },
        ],
      }),
    /MAX_TOKENS|incomplete/i,
  );
});