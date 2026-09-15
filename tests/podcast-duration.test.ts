import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPodcastScriptWithinWordBudget,
  isPodcastAudioDurationWithinRange,
  parsePodcastDuration,
} from "../lib/podcast-duration";

function scriptWithWords(wordCount: number) {
  return {
    segments: [
      {
        text: Array.from({ length: wordCount }, (_, index) => `word${index}`).join(" "),
      },
    ],
  };
}

test("parses supported podcast duration ranges and legacy aliases", () => {
  const short = parsePodcastDuration("1-2 minutes");
  assert.deepEqual(
    short && {
      label: short.label,
      minSeconds: short.minSeconds,
      maxSeconds: short.maxSeconds,
      maxWords: short.maxWords,
    },
    {
      label: "1-2 minutes",
      minSeconds: 60,
      maxSeconds: 120,
      maxWords: 225,
    },
  );
  assert.deepEqual(parsePodcastDuration(" 1 – 2 MIN "), short);
  assert.deepEqual(parsePodcastDuration("120"), short);
  assert.deepEqual(parsePodcastDuration("3-4 minutes")?.minSeconds, 180);
  assert.deepEqual(parsePodcastDuration("5-7 minutes")?.maxSeconds, 420);
});

test("rejects unsupported duration ranges instead of falling through to a prompt", () => {
  assert.equal(parsePodcastDuration("2-3 minutes"), null);
  assert.equal(parsePodcastDuration("90 seconds"), null);
  assert.equal(parsePodcastDuration(""), null);
});

test("rejects a script over budget before TTS", () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  assert.doesNotThrow(() =>
    assertPodcastScriptWithinWordBudget(scriptWithWords(range.maxWords), range, "initial generation"),
  );
  assert.throws(
    () =>
      assertPodcastScriptWithinWordBudget(
        scriptWithWords(range.maxWords + 1),
        range,
        "initial generation",
      ),
    /exceeds the 1-2 minutes conservative word budget/,
  );
});

test("rechecks the post-review script rather than silently cutting narration", () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  const reviewedScript = scriptWithWords(range.maxWords);
  assert.doesNotThrow(() =>
    assertPodcastScriptWithinWordBudget(reviewedScript, range, "initial generation"),
  );
  reviewedScript.segments[0]!.text += " review-expanded narration";
  assert.throws(
    () => assertPodcastScriptWithinWordBudget(reviewedScript, range, "post-review"),
    /exceeds the 1-2 minutes conservative word budget after post-review/,
  );
});

test("finished audio must be inside the requested range before ready", () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  assert.equal(isPodcastAudioDurationWithinRange(60, range), true);
  assert.equal(isPodcastAudioDurationWithinRange(120, range), true);
  assert.equal(isPodcastAudioDurationWithinRange(59.999, range), false);
  assert.equal(isPodcastAudioDurationWithinRange(120.001, range), false);
});