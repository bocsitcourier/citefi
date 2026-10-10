# Selected speech/video QA — preparation, not certification

Status: **NOT CERTIFIED**. The user refused new paid QA while two historical
provider calls remain unreconciled and their source records are unavailable.
No new paid call or paid end-to-end success is authorized or claimed here.

Conflicting branch documentation describes later selected-media executions,
including a podcast pass, a failed video attempt, and a video recovery pilot.
The corresponding ledger histories conflict and supporting immutable records
are unavailable for this merge. Those descriptions are retained as disputed
historical claims only; they are not verified results, approvals, settlements,
or evidence that a paid end-to-end test passed. The shared ledger remains
unresolved and must not be edited to choose or invent a reconciliation.

`QA/evidence/live-current/budget-ledger.json` is a dispute sentinel, not a
balance. Both byte-exact source versions are separately hash-bound as
non-authoritative snapshots in `budget-ledger-dispute.json`; every live paid QA
entrypoint is blocked until real reconciliation and separate owner permission.

The production speech default is unchanged. The original image-only execution
permission has been consumed; offline image reconciliation did not authorize
a retry. The failed article and image cases remain failed.

The owner subsequently authorized **preparation only** of a separate video
recovery plan. See `VIDEO_RECOVERY_PLAN.md`: retained script/TTS reuse, a
separately approved pilot before nine further clips, proposed additional reserve
$6.10, no release of the old $6.30 hold and no current paid permission.
The recovery runner and financial exception are not implemented or approved
for execution by that preparation decision.

## Prepared execution bounds (not paid authorization)

| Stage | Selected native calls | Hard limits | Reserve |
|---|---|---|---|
| Podcast | One Gemini 3.5 Flash script; OpenAI TTS-1 segments | ≤40 TTS submissions; ≤30,000 total characters, ≤4,096 each | $0.65 |
| Video | One Gemini 3.5 Flash script; one TTS-1 narration; Veo 3.1 Fast clips | ≤4,096 narration characters; ≤10 clips, one 6s 720p result each | $6.30 |

Combined reserve: **$6.95**, proposed against the existing shared **USD30**
ceiling, not a new budget or authorization. The preparation record's last
preflight snapshot was **$22.939297** available, prior known valuation $0.517071,
historical unknown-call hold $6 (coverage, not actual spend), and new committed
estimates $0.543632. Later ledger versions conflict, so that snapshot is not a
current balance.

Each script permits at most 32,768 UTF-8 request bytes, conservatively 65,536
input tokens and 8,192 output tokens including thinking. Per-script bound:
$0.172032. Total stage maxima: podcast $0.622032; video $6.233472.

Official standard pricing, retrieved 2026-10-08:

- [OpenAI TTS-1](https://developers.openai.com/api/docs/models/tts-1):
  $15/M input characters. **Deprecated**; a rejection stops the case.
- [Speech endpoint](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create):
  at most 4,096 input characters.
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing):
  Gemini 3.5 Flash input $1.50/M, output $9/M including thinking;
  Veo 3.1 Fast 720p $0.10/s.

Retained pricing records and hashes:
`evidence/live-current/openai-bounded-speech-source.md`,
`selected-media-pricing.md`, and `selected-media-preflight.json`.
Execution requires same-UTC-day pricing; changed code/source/manifest hashes
require a fresh matching execution decision and owner permission.

## Admission and failure boundaries

The runner requires two matching approval artifacts under the retained evidence
root: `selected-media-execution-decision.json` and
`selected-media-paid-authorization.json`. Preparing this plan creates neither
owner paid permission nor a provider request.

Run **podcast first**, then video only after successful podcast acceptance,
settlement, and complete pre-cleanup export. One paid run per stage per approved
manifest; no replay, retry, model fallback or fresh-ID workaround. Failed or
incomplete acceptance/export blocks the next paid stage.

The immutable manifest binds the relevant implementation file hashes.
Every physical submission needs an owned prepared attempt-1 receipt. Native
responses, bytes, IDs, usage and priced units are retained before forwarding.
Veo operation acknowledgments are durably written before polling. Limits:
30 polls / 300 seconds per operation, one acknowledged native-result download,
64MiB response limit, per-request timeouts; stage watchdogs are 10 minutes for
podcast and 15 minutes for video. Unknown usage/completion retains the full
stage reservation and lock. A deadline preserves owned state rather than
silently deleting evidence, with a two-second termination grace. Each paid POST
rechecks fresh pricing and the exact still-approved implementation manifest.

Prohibited: new image calls, paid expansion/critic/judge/grounding/Drive,
unlisted network requests, customer DB, publishing, scheduler startup and cloud
storage claims. Ordinary application workflows are not started for this QA.

## Verified offline evidence

Both runs invoke the authenticated generation routes, owned Redis queue jobs,
exported workers, selected production script/TTS/Veo adapters and actual local
FFmpeg processing, with **simulated native provider responses**:

- `evidence/selected-media-offline/offline-selected-podcast-two-hosts-20261008`:
  two speakers, two separate MP3 containers merged into one valid MP3;
  60.081633s, mean audio −22dB, full decode, HTTP200, cross-tenant HTTP401,
  anonymous denial, three correlated/accounted receipts, debit and export.
- `evidence/selected-media-offline/offline-selected-video-complete-narration-20261008`:
  ten distinct operation IDs, native 6s 720p fixture clips, actual stitch and
  narration; 55.5s final video, mean audio −21.5dB, full decode, retrieval and
  tenant/anonymous and forged conflicting-owner denial, twelve correlated/accounted receipts, debit and
  export. Final 1080p is a local upscale, **not** a paid 1080p model request.

Receipts, usage/rates, credit rows, native artifacts and delivered bytes were
exported and fsynced before owned DB cleanup. Offline copies of the shared
ledger are isolated; the real ledger and prior receipts were not mutated.
Intermediate failed offline runs are retained, not represented as passes.
Large simulated binary fixtures remain on disk; their receipts/hashes are
tracked separately rather than adding generated MP3/MP4 blobs to Git.

Checks: TypeScript clean, budget guard tests 11/11, local MP3 merge tests 2/2,
narration preservation tests 2/2. Longer narration is locally fitted at no more
than 1.5×; shorter narration is padded, never used to cut later visual scenes.
Owned tests also exposed and corrected independent-container MP3 concatenation,
concurrent readiness-probe collisions, and missing video-idea retrieval
ownership. Unpublished idea videos require an exact persisted URL owner;
conflicting tenant owners fail closed and cannot grant anonymous access.

These tests use a durable filesystem adapter, **not cloud storage**. The video
script uses the selected production Veo script seam, with paid expansion/judges
and optional auxiliaries deliberately omitted. No default speech model, full
default video pipeline, historical unknown-call spend or article success is
certified by these fixtures.

## Commands

Preparation is offline:

```sh
node scripts/qa-live-selected-media.mjs preflight
node --test tests/qa/selected-media-budget.test.mjs
node --import tsx/esm --test tests/merge-mp3-segments.test.ts
```

Real execution remains blocked by the user's refusal, unresolved historical
calls, unavailable source records, retained ambiguous holds, and stale approval
hashes. The commands below are invocation syntax only, not permission to run:

```sh
node scripts/qa-live-selected-media.mjs run podcast <unique-approved-run-id>
# Only after podcast acceptance, settlement and complete export:
node scripts/qa-live-selected-media.mjs run video <unique-approved-run-id>
```

No dotenv file or customer database is used. On any ambiguity or failed export,
stop and retain evidence; do not remove a held reservation, lock, owned DB or
provider artifacts as a workaround.
