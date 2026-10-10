# Selected video recovery — preparation only

Status: **NOT CERTIFIED / NOT EXECUTABLE / NO PAID PERMISSION**.

The owner authorized preparation of a separately reviewed recovery plan after
the failed selected-video run. This does not authorize implementing a financial
exception, releasing a hold, submitting a pilot, or rerunning the video. The
original once-only paid permission is consumed and its code hashes are stale.
This is an execution-risk proposal, not a completion review.

## Evidence available for reuse

Source directory: `evidence/live-current/live-selected-video-20261008/`.

| Retained source | SHA-256 | Meaning |
| --- | --- | --- |
| `call-1-native.json` | `0cae3ef3eb33751a1cb242b8cd07369ee9f0539c82a7357085c34b0d5a6bec06` | Actual Gemini script response; ten scenes, 60s requested visual duration |
| Canonical parsed script (`JSON.stringify` of non-thought candidate text JSON) | `f2496cb28fe25844074dfb458bf0fa0bfb2e7213832e350255d2fea6f01ed44c` | Freeze every scene, prompt and narration; no new script generation |
| `call-2-native.mp3` | `60a6f085109bb2ca03ce52615bc019e8b7c65d13505274e4ae176f52fd0989e7` | Actual TTS-1 narration, 1,273,344 bytes |

Preparation-only local FFmpeg inspection on 2026-10-08: narration is MP3,
mono, 24kHz, 79.584s; full decode succeeds, mean volume −25.9dB, peak −5.4dB.
With ten 6s scenes and nine 0.5s transitions, the expected visual duration is
55.5s. Required narration tempo is approximately 1.434×, below the existing
1.5× ceiling. Actual native clip durations must still be checked before mixing.
Never truncate the narration or later scenes to manufacture a passing result.

The prior podcast pass is reusable evidence, not permission to regenerate it.
Its source manifest differs from current code. Any future recovery approval
must explicitly accept that historical pass rather than weakening the ordinary
same-manifest podcast admission rule.

Nine old physical clip submissions remain uncertain. No captured operation ID,
HTTP status or video exists for those submissions. A new call using one of
their prompts may duplicate earlier provider work. Owner approval must
acknowledge this risk; new IDs must not disguise a replay as previously unpaid.

## Financial proposal

The retained shared USD30 ledger, read without mutation during preparation:

- Known prior valuation: $0.517071.
- Historical unknown-call coverage: $6.00, not actual spend.
- Current new committed amount: $6.885916, including the failed video's entire
  $6.30 reservation; its known script/TTS valuation $0.046806 is inside that hold.
- Current available amount: **$16.597013**.
- `budget-ledger.json` snapshot SHA-256:
  `bf41a68c999a80f3f96e1dd4424322565f092b830368f165a79bf0902e048bff`.
- Original `budget.lock` SHA-256:
  `5b8047c0f2016c569b5184ae306bb3632adf27540f95110bc981d5d23808a707`.
- Current selected-media implementation manifest SHA-256:
  `f4584563bb5df161718e9cf34280ead20aa9d99f3867016976522af31ae87c7d`.
  This is a preparation snapshot, **not** the hash of a future recovery runner.

Public official pricing was rechecked 2026-10-08. Google lists Veo 3.1 Fast
video with audio at **$0.10 per second for 720p**. The documentation supports
6s output at 720p and uses `v1beta` for preview generation. Sources and selected
excerpts: `evidence/live-current/video-recovery-pricing-source.md`.
Native audio is part of this rate even though the final mix uses retained TTS.

| Proposed phase | New paid generation | Maximum valuation | Proposed reserve |
| --- | --- | --- | --- |
| Pilot | Scene 1 only, one 6s 720p clip, one sample | $0.60 | $0.65 |
| Completion, only after pilot acceptance and a new owner approval | Scenes 2–10 only, nine 6s 720p clips, one sample each | $5.40 | $5.45 |
| Total | Ten new clips; no script, TTS, podcast or image calls | $6.00 | **$6.10** |

Conservative additional commitment of the full $6.10 leaves **$10.497013**
available while keeping all earlier coverage intact. The unused $0.10 margin
does not authorize an eleventh clip, a retry, a different model or resolution.
Prices must be fetched again on the UTC day of any execution. A price change
invalidates these bounds and requires a fresh review and owner decision.

## Required implementation before any paid permission request

1. Build a **separate recovery-only runner**, never a bypass in ordinary
   `assertPaidMediaPermission` or `reserveSelectedMediaRun`. Bind its final code,
   source/pricing hashes, original held-run identity, prior podcast acceptance,
   immutable script/audio hashes, allowed scene indices, receipt lineage and
   hard bounds into a new manifest. Offline preparation is the only currently
   authorized action.
2. Keep the existing `budget.lock` bytes and old $6.30 pending entry intact.
   The proposed exception requires explicit architect and owner authorization.
   A separate exclusive recovery lock would serialize only this named child
   execution. Verify the parent runtime has terminated before admission.
   Original runners remain blocked; unrelated or overlapping recovery is denied.
   Under the exclusive lock, validate the expected ledger snapshot and reserve
   a distinct child entry against the **same** shared USD30 ledger. At later
   phase admission, validate the then-current approved ledger and prior pilot
   settlement, not a stale original snapshot. Failed admission makes no change.
   Acquire `video-recovery.lock` with exclusive create (`wx`), fsync its descriptor
   and directory, and bind it to one manifest/phase/run identity. Every shared
   ledger writer must honor this lock or refuse the held parent lock; audit that
   contract before admission. Persist an atomic, fsynced reservation journal,
   then replace/fsync the ledger under that exclusive lock. No POST is permitted
   until the journal, child ledger entry and prepared attempt have all been
   re-read and verified. Compare ledger hashes before every update; divergence
   stops rather than overwrites another writer. A crash retains the lock/journal
   and blocks execution until a separately reviewed recovery decision.
   Parent termination requires the original launch controller's terminal result
   plus witnessed teardown of its owned worker/DB/Redis process tree and absence
   of matching active processes. A stale PID, missing PID or completed export
   alone is insufficient. Do not kill a process merely because its PID matches.
   Missing trustworthy termination evidence blocks live admission.
3. Preserve all old rows, outcomes, receipts, holds and exports. A child entry
   links to the original ambiguous run but never settles, refunds or reclassifies
   it. Original application credit state remains RESERVED in its exported
   evidence. Any new credit reservation belongs only to the fresh owned QA DB;
   customer credits and customer databases remain untouched.
4. Reuse the retained script/TTS with explicit historical-evidence references.
   Do not create new successful native receipts, re-submit old attempts or bill
   script/TTS again. Reuse scene 1's pilot MP4 in completion; hash-check it and
   carry its priced receipt lineage. One physical call per permitted new scene,
   **one scene in flight**, no retries, fallback or automatic next-phase execution.
5. Refuse script/TTS/image/judge/critic/expansion/grounding/Drive/learning requests
   at the network guard, not merely by supplying cached dependencies. Enforce
   exact `veo-3.1-fast-generate-preview`, `v1beta`, 720p, 6s, one sample and frozen
   scene prompt before any request leaves. Preserve HTTP metadata before body
   parsing, raw acknowledgements and operation IDs before polling.
6. Allow only GETs for this run's acknowledged operation IDs and returned native
   file URIs. At most 30 polls and 300s per clip, one bounded native download
   per acknowledged result, 64MiB per response. Recovery-specific timeouts:
   60s submission, 30s per poll within the inclusive 300s polling deadline,
   60s download. Stage watchdogs: **12 minutes pilot, 70 minutes completion**,
   including processing/export, with two-second termination grace. Completion
   covers nine sequential 420s maximum clip lifecycles (63 minutes), plus
   four minutes local processing, two minutes export, one minute overhead.
   Pilot allows seven minutes clip lifecycle, one minute inspection and two
   minutes export, with two minutes overhead. These are proposed new bounds,
   not an extension of the consumed 15-minute original permission.
   Reserve the full next-clip lifecycle and final processing/export time before
   admitting a POST; insufficient remaining deadline blocks that clip.
   A UTC-date change blocks new POSTs, without forbidding bounded GET completion
   of already-acknowledged operations. Unknown HTTP/native acknowledgement,
   timeout, download, accounting or decode failure stops before another scene.
   No SDK retry may cause a second physical submission.
7. Spool every new attempt, native response, operation ID, poll and asset before
   further processing. On a failed or uncertain phase retain its entire child
   reserve and child lock. Do not shrink coverage from completed siblings or
   infer zero cost from an application rejection. Export all receipts, COGS,
   credit records, source references and artifacts before owned DB cleanup;
   failed export preserves the owned DB. A later recovery is a new reviewed
   decision, never automatic.
   A partially completed phase exports every completed clip and its native cost,
   keeps the full child hold, and does not resume itself. A future decision may
   cover only missing scenes, explicitly reuse proven completed scenes and
   preserve all earlier uncertain holds. Completed scenes must never be regenerated
   under a fresh-ID workaround.
8. Prove these gates with **isolated offline copies** of the held ledger, native
   sources, owned Postgres/Redis and simulated clips. Required negative cases:
   stale approval/pricing/source hashes; missing prior acceptance; parent still
   running; wrong held-run identity; changed original lock/held entry; parallel
   admission; exhausted budget; scripts/TTS denied; duplicate scene; second POST;
   wrong model/resolution/duration/sample count; unacknowledged poll/download;
   empty acknowledgement; non-2xx JSON; missing ID; timeouts; export failure.
   Prove the retained parent entry and lock are byte-for-byte unchanged.
   Include process-death injection after reservation, after actual provider
   acceptance but before local acknowledgement persistence, after receipt
   persistence, and during export. Also cover competing ordinary/child writers,
   ledger divergence and partial-stage restart with completed scenes denied.

## Immutable inventory and native validation

`evidence/live-current/video-recovery-source-inventory.json` enumerates the
original script/TTS source-event identifiers, their native and receipt hashes,
exported usage/rate evidence, each of the nine old physical POST fingerprints,
request-metadata file hashes, scene mapping and raw acknowledgement hashes.
Canonical script derivation concatenates the first candidate's non-thought text
parts, parses JSON and hashes `JSON.stringify(parsed)`; use that exact derivation
and freeze every scene in the eventual recovery manifest.

The old wire request bodies and exact wire prompt hashes were **not retained**.
The inventory labels script-derived scene prompt hashes separately; they are
not proof of the fully sanitized transmitted prompt. Empty-body acknowledgement
hashes are evidence of zero captured bytes, not free or rejected provider work.
Old HTTP statuses, operation IDs and file URIs are unavailable; no offline
reconstruction can recover them. The nine old requests may still complete or
be charged, and new clips can duplicate their work.

Bind the complete inventory file hash and newly refreshed public source/pricing
file hashes into the future manifest. The official wildcard REST endpoint and
official exact Fast model code resolve to:
`https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning`.
This is derived from two official references, not a paid compatibility probe.
Freeze one `instances` item, `sampleCount: 1`, `durationSeconds: 6`,
`resolution: "720p"`, `aspectRatio: "16:9"` and the actual sanitized prompt in
each new prepared request. Preserve the exact new wire body before submission.

Accept only a non-error `Operation` with a valid unique acknowledged name;
accept model-qualified names only for the selected Fast model. Bare operation
names require direct correlation to that run's exact whitelisted request, not
an invented model claim. Persist acknowledgement before any GET. Require
`done: true`, no error or filtering failure, exactly one generated sample/video
entry (not merely one nonempty URI extracted from several entries) and one
approved native URI. Reject unexpected schema, cardinality or reported model.
If a response omits model/duration/resolution telemetry, do not invent it:
retain request-level model proof and independently probe the actual result.
Require native 1280×720 and duration within a declared small container tolerance
of 6s (proposed ±0.1s, not an extra billable second). Any result/shape mismatch,
oversized asset or second sample stops before another POST and retains the hold.

Each completed requested six-second result is valued at the locked
$0.10/second rate: **600,000 microusd**, not decoded-container duration and not
an invoice. Persist native attempt/result, operation ID, full HTTP/poll/download
history, rate snapshot, usage and COGS correlation plus the owned-QA credit
reservation/entry before another scene. Maintain a durable per-scene accounting
barrier; final QA credit debit occurs only at full worker success. If accounting
or rate evidence cannot be persisted, stop with the full reserve held.
Unspent reserve is releasable only after all phase acceptance predicates,
complete pre-cleanup exports and a durable phase settlement; release only that
child lock. Incomplete or oversized/multi-result phases never auto-settle.

## Separate gates for real execution

**Pilot admission:** finished offline verification, current pricing, final
implementation manifest, architect's explicit conditional execution decision,
then owner permission for **one pilot only, up to $0.65**, acknowledging the
old hold, separate child-lock exception and possible duplicate provider work.
No such permission exists now.

**Pilot acceptance:** persist operation ID before polls; actual native 1280×720
video with approximately 6s duration, complete FFmpeg video/audio decode, nonempty
frames, native accounting correlated to its single attempt; durable owned storage
and authenticated same-byte retrieval, cross-tenant/anonymous denial; export
before cleanup and settle the child reserve from retained locked-rate evidence.
This is a raw-clip diagnostic, **not** the narrated final product or full worker
acceptance. Any failure stops recovery. Scene 1 must remain on disk for reuse.

**Completion admission:** review the actual pilot evidence, freeze the pilot
asset/receipt/settlement hashes and current shared ledger, get a matching
architect decision and owner permission for **only nine remaining clips,
up to $5.45**. Preparing or paying for a successful pilot is not this permission.

**Completion acceptance:** invoke the actual authenticated production video
route, owned queue and exported worker, using sealed script/TTS and pilot-clip
reuse seams with no generation calls at those seams. Before actual generation,
prove cross-tenant route denial makes zero submissions. Generate scenes 2–10
sequentially, stitch all ten actual clips and attach the complete retained
narration. Verify native dimensions/durations, ordered scenes, complete decoding,
full narration fitting without cuts, non-silent delivered audio; authenticated
retrieval byte equality and tenant/anonymous/conflicting-owner denial; owned
application debit, new COGS and reuse provenance without double counting historical
script/TTS or pilot cost; complete exports before cleanup and evidence valuation.

Accounting must distinguish current native costs, inherited proven costs and
unresolved older attempts. Historical script/TTS contributes $0.046806 to asset
provenance, not to a second shared-ledger debit. Pilot cost is settled once and
linked, not added again to completion cost.

## Certification and next decision

No default speech model, cloud storage, default full auxiliary pipeline, article
success or prior failed image route is certified by this proposal or recovery.
The selected podcast pass remains valid on its documented scope. The old nine
clip submissions stay uncertain even if new video playback succeeds.

Preparing this plan does not complete the assigned end-to-end QA task. After
review of this document, the next proposed owner decision is **whether to
implement and verify the recovery runner offline**, not whether to pay now.
