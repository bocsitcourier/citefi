# RC4 Worker QA / Remediation Report

## Scope

This pass implements the RC4 duration and provider-output safety controls
without changing models, dependencies, provider contracts, database schema, or
automatic replay behavior. Paid calibration and paid regeneration remain
disabled.

## Podcast duration controls

- Supported podcast choices retain their strict advertised ffprobe bounds:
  `1-2 minutes` is `60 <= seconds <= 120`, `3-4` is `180 <= seconds <= 240`,
  and `5-7` is `300 <= seconds <= 420`. Values outside either endpoint are
  rejected; there is no tolerance.
- Before the first TTS request, every segment is word-counted and receives an
  explicitly labeled planning estimate. The editorial planning rate is 150
  WPM, deliberately not presented as measured voice/locale calibration.
- Lower and upper pre-TTS planning bounds are enforced for the complete script.
  A short or long script fails before the injected/paid TTS boundary; no
  narration is truncated or semantically cut.
- Reviews/repairs are preflighted again immediately before TTS.
- Finished audio is probed with ffprobe and must pass the same hard bounds
  before upload, asset insertion, or ready status. A missing/invalid probe
  fails rather than becoming an estimate.
- Persisted podcast metadata now distinguishes exact measured ffprobe seconds
  from planning estimates and records `calibrationStatus: "missing"`.
  Historical rows are not rewritten.
- The content UI, generated embed, canonical media-library records, and website
  publishing payload use persisted measured seconds when present, with the
  integer article field used only as a legacy fallback.
- A shared browser-safe provenance resolver returns `{ seconds, source }`:
  current finite ffprobe metadata is `ffprobe`, historical
  `durationSource: "ffprobe"` plus `audioDurationSeconds` is
  `historical-ffprobe`, integer-only article fallback is `legacy`, and missing
  data is `unknown`. Legacy/unknown values are never labeled measured.

## Bounded video parsing and diagnostics

- Gemini and Veo script parsers now reject empty, oversized, malformed,
  truncated, non-`STOP`, or structurally incomplete output. They enforce
  bounded titles, scene/clip counts, target durations, required strings, and
  per-field limits. JSON repair is not used for these scripts.
- Idea-video script parsing has the same bounded response and clip contract
  checks.
- Idea expansion and video-style analysis now reject non-`STOP`, empty,
  oversized, malformed, truncated, incomplete, or overlong-field JSON before
  downstream script/video work. Style analysis no longer silently substitutes
  a generic style when the provider response is invalid.
- Provider output and error diagnostics retain only a bounded path, type/code,
  SHA-256 digest, and length. Raw provider payloads, response bodies, prompt
  excerpts, and exception messages are not logged in the affected paths.
- The prior video script length enforcer is no longer used to truncate or
  zero narration scenes.

## Regression coverage

The following local checks passed:

```text
npx tsc --noEmit --pretty false
node --import tsx/esm --test \
  tests/podcast-duration.test.ts \
  tests/batches/veo-idea-script-contract.test.ts \
  tests/batches/video-script-contract.test.ts
git diff --check
```

The focused test run passed 16 tests, including:

- exact `59.999`, `60`, `120`, and `120.001` duration boundary behavior;
- short and long complete-script preflight with zero injected TTS calls;
- per-segment estimate and missing-calibration labels;
- measured metadata persistence and rejection of out-of-range measurements;
- current, historical-ffprobe, legacy, and unknown duration provenance;
- complete bounded five-scene parsing, truncated/`MAX_TOKENS` rejection, and
  redacted diagnostic assertions;
- incomplete/oversized/`MAX_TOKENS` idea concepts and style-analysis JSON.

No live provider, paid calibration, database write, object-storage write,
workflow restart, or automatic replay was run in this pass.

## Architect review gate

Implementation is complete for this pass. Stop here for architect review
before RC5 or any broader provider/UI rollout.