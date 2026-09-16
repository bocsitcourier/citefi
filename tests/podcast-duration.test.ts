import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPodcastScriptWithinWordBudget,
  createPodcastMeasuredDurationMetadata,
  isPodcastAudioDurationWithinRange,
  parsePodcastDuration,
  preflightPodcastScriptDuration,
  renderPodcastSegmentsAfterPreflight,
} from "../lib/podcast-duration";
import { resolvePodcastDurationProvenance } from "../lib/podcast-duration-provenance";

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
      minWords: short.minWords,
      maxWords: short.maxWords,
    },
    {
      label: "1-2 minutes",
      minSeconds: 60,
      maxSeconds: 120,
      minWords: 150,
      maxWords: 300,
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

test("pre-TTS preflight covers every segment with an explicit estimate", () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  const preflight = preflightPodcastScriptDuration(
    {
      segments: [
        { voice: "female", text: scriptWithWords(75).segments[0]!.text },
        { voice: "male", text: scriptWithWords(75).segments[0]!.text },
      ],
    },
    range,
    "post-review",
  );

  assert.equal(preflight.totalWords, 150);
  assert.equal(preflight.segments.length, 2);
  assert.equal(preflight.estimatedSeconds, 60);
  assert.equal(preflight.estimateLabel, "estimate");
  assert.equal(preflight.calibrationStatus, "missing");
  assert.match(preflight.planningRateSource, /estimate/i);
});

test("short and long scripts are rejected before the injected TTS boundary", async () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  let calls = 0;
  const render = async () => {
    calls += 1;
    return Buffer.from("provider-result");
  };

  await assert.rejects(
    renderPodcastSegmentsAfterPreflight(
      scriptWithWords(range.minWords - 1),
      range,
      "post-review",
      render,
    ),
    /outside.*hard pre-TTS plan/,
  );
  await assert.rejects(
    renderPodcastSegmentsAfterPreflight(
      scriptWithWords(range.maxWords + 1),
      range,
      "post-review",
      render,
    ),
    /outside.*hard pre-TTS plan/,
  );
  assert.equal(calls, 0);
});

test("measured metadata keeps ffprobe authoritative and labels planning as estimate", () => {
  const range = parsePodcastDuration("1-2 minutes")!;
  const plan = preflightPodcastScriptDuration(
    scriptWithWords(range.minWords),
    range,
    "post-review",
  );
  const metadata = createPodcastMeasuredDurationMetadata(60.125, range, plan);

  assert.equal(metadata.measuredDurationSeconds, 60.125);
  assert.equal(metadata.audioDurationSeconds, 60.125);
  assert.equal(metadata.durationSource, "ffprobe");
  assert.equal(metadata.planningDurationLabel, "estimate");
  assert.equal(metadata.calibrationStatus, "missing");
  assert.throws(
    () => createPodcastMeasuredDurationMetadata(59.999, range, plan),
    /outside the hard range/,
  );
});

test("duration provenance distinguishes current, historical, legacy, and unknown values", () => {
  assert.deepEqual(
    resolvePodcastDurationProvenance(
      {
        durationSource: "ffprobe",
        measuredDurationSource: "ffprobe",
        measuredDurationSeconds: 61.25,
        audioDurationSeconds: 61,
      },
      60,
    ),
    { seconds: 61.25, source: "ffprobe" },
  );
  assert.deepEqual(
    resolvePodcastDurationProvenance(
      { durationSource: "ffprobe", audioDurationSeconds: 62.5 },
      60,
    ),
    { seconds: 62.5, source: "historical-ffprobe" },
  );
  assert.deepEqual(
    resolvePodcastDurationProvenance(
      {
        durationSource: "ffprobe",
        measuredDurationSource: "estimate",
        measuredDurationSeconds: 88,
        audioDurationSeconds: 62.5,
      },
      60,
    ),
    { seconds: 62.5, source: "historical-ffprobe" },
  );
  assert.deepEqual(
    resolvePodcastDurationProvenance(null, 63),
    { seconds: 63, source: "legacy" },
  );
  assert.deepEqual(
    resolvePodcastDurationProvenance({ durationSource: "estimate" }, null),
    { seconds: null, source: "unknown" },
  );
});