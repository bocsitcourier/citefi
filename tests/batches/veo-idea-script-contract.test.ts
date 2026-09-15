import assert from "node:assert/strict";
import { test } from "node:test";

process.env.GEMINI_API_KEY ??= "contract-regression-no-provider-call";

const {
  VideoScriptContractError,
  extractIdeaScriptResponseText,
  parseIdeaVideoScriptResponse,
} = await import("../../lib/veo-idea-script-generator");
const { classifyError } = await import("../../lib/errors");

function realisticTenClipScript() {
  return {
    title: "A practical Boston winter home-energy checklist",
    totalDuration: 60,
    companyName: "Harbor Home Energy",
    style: "minimal",
    tone: "friendly",
    clips: Array.from({ length: 10 }, (_, index) => ({
      sceneNumber: index + 1,
      targetDuration: 6,
      beat:
        index < 2
          ? "hook"
          : index < 4
            ? "problem"
            : index < 6
              ? "solution"
              : index === 6
                ? "benefits"
                : index === 7
                  ? "proof"
                  : "cta",
      prompt:
        "Photorealistic Boston home-energy scene with natural movement, realistic materials, " +
        "soft winter light, a slow tracking camera, and no text or logos.",
      narration:
        index < 8
          ? "Small winter preparation steps can make a Boston home calmer, warmer, and more efficient."
          : "Visit our website and get started today with Harbor Home Energy.",
      visualCue: "Warm home interior with visible winter light",
    })),
  };
}

test("accepts a realistic complete ten-clip response and excludes thought parts", () => {
  const script = realisticTenClipScript();
  const answer = JSON.stringify(script);
  const response = {
    candidates: [{
      finishReason: "STOP",
      content: {
        parts: [
          { thought: true, text: "Hidden planning must never enter the JSON parser." },
          { text: answer },
        ],
      },
    }],
    text: answer,
  };

  assert.equal(extractIdeaScriptResponseText(response), answer);
  const parsed = parseIdeaVideoScriptResponse(response);
  assert.equal(parsed.clips.length, 10);
  assert.equal(parsed.clips[9]?.targetDuration, 6);
});

test("rejects MAX_TOKENS and truncated JSON before any Veo stage", () => {
  const answer = JSON.stringify(realisticTenClipScript());
  const truncated = answer.slice(0, -37);

  assert.throws(
    () =>
      parseIdeaVideoScriptResponse({
        candidates: [{
          finishReason: "MAX_TOKENS",
          content: { parts: [{ text: truncated }] },
        }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof VideoScriptContractError);
      assert.equal(error.code, "MODEL_OUTPUT_INVALID");
      assert.match(error.message, /MAX_TOKENS|incomplete output/i);
      return true;
    }
  );

  // Even if an SDK omits finishReason, a truncated prefix must not be
  // json-repaired into a fake complete script.
  assert.throws(
    () =>
      parseIdeaVideoScriptResponse({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: truncated }] },
        }],
      }),
    /malformed or truncated script JSON/i
  );

  const classified = classifyError(
    new VideoScriptContractError("truncated script"),
    "video_gen",
    { provider: "gemini" }
  );
  assert.equal(classified.code, "MODEL_OUTPUT_INVALID");
  assert.equal(classified.disposition, "fatal");
});
