# Video recovery: offline implementation verified

**Status: OFFLINE VERIFIED — REAL VIDEO NOT CERTIFIED.**

The owner authorized implementation and isolated verification only. There were
**no new paid provider calls**, no customer database access, no production
default changes, no unrestricted workers/schedulers and no publishing.

## Final verification

Frozen implementation/pricing/source manifest:
`c097bd84a4e2563ded8f418b070c822fc23cb25a34dc8ec07b055621dfb6b5ca`.

- `node --test tests/qa/video-recovery-budget.test.mjs tests/qa/selected-media-budget.test.mjs`:
  **50 passed, zero failed**.
- `npx tsc --noEmit --pretty false`: passed.
- `git diff --check`: passed.
- `node scripts/qa-video-recovery.mjs offline both offline-video-recovery-export-20261009`:
  isolated production-route/exported-worker acceptance passed.

Final retained fixture archives:

- `QA/evidence/selected-media-offline/offline-video-recovery-export-20261009-pilot`
- `QA/evidence/selected-media-offline/offline-video-recovery-export-20261009-completion`

Earlier local runs are intermediate debugging evidence, not the final archived
acceptance or native execution. The final archives include each phase's
`outcome.json`, `budget-settlement.json` and `export-before-cleanup.json`.
Provider/native evidence was exported before owned cleanup; post-settlement
records were also copied before the selected phase changed.

| Offline phase | Fixture playback | Delivered bytes | Full decode | Audio mean | Fixture valuation, NOT real spend |
| --- | --- | --- | --- | --- | --- |
| Pilot | 6 seconds | 3,022,988 | Passed | -21.1 dB | $0.60 |
| Completion | 55.5 seconds | 18,410,735 | Passed | -26.1 dB | $5.40 |

The ten new clip responses above were **simulated**. The script and 79.584-second
TTS-1 narration were reused from the retained, previously authorized real run.
The completion used the whole narration at local tempo approximately 1.434,
below the 1.5 limit. It made no new script/speech request.

Checks exercised: one clip in flight, strict order, native acknowledgement and
operation-ID persistence, acknowledged polling/downloads, strict one-sample
720p/6-second acceptance, full FFmpeg decoding, nonsilent final audio, durable
fixture storage, authenticated same-byte retrieval, anonymous/foreign-team/
conflicting-owner denial, clip receipt/COGS barriers, production worker debit,
and export-before-owned-cleanup.

Failure tests cover missing/stale permission, manifest/price/ledger/proof changes,
missing original hold or changed lock, crash points, replay/concurrent admission,
budget shortfall, missing pilot evidence, partial completion, invalid clip
duration/resolution, absent accounting, malformed/empty/lost acknowledgements,
extra native samples, forbidden auxiliary requests, unacknowledged URLs,
poll-count/time/version/HTTP bounds and oversized downloads. Uncertainty keeps
the full child reserve; it never releases the historical parent hold.

## Original live finances remain unchanged

Original ledger SHA-256:
`bf41a68c999a80f3f96e1dd4424322565f092b830368f165a79bf0902e048bff`.

Original primary lock SHA-256:
`5b8047c0f2016c569b5184ae306bb3632adf27540f95110bc981d5d23808a707`.

The original **$6.30 video reserve remains held**, and the shared $30 ledger's
available capacity remains **$16.597013**. These hashes were checked after final
fixture cleanup. The fixture valuations above did not modify the live ledger.

The original nine physical Veo submissions still have no native HTTP status or
operation ID. Their billing/completion is unknown; the application rejection
label is not proof of zero spend. The prior real podcast remains accepted;
the original image application's HTTP-500 outcome remains failed despite valid
native decoded image bytes and approved offline financial reconciliation.

## Live execution remains blocked

Official public pricing was fetched again on 2026-10-09: selected Veo 3.1 Fast
720p with audio is $0.10/second. See
`QA/evidence/live-current/video-recovery-pricing-current.md`. This is not an
invoice, permission or proof of old clip charges.

New live recovery requires all of the following:

1. A separate architect **execution** decision for the frozen current manifest.
2. Positive, bound launcher/owned-process shutdown evidence for the historical
   run. Assertion-only/simulated proof or stale-PID inference is rejected.
3. New owner permission for **one scene-1 pilot only**, maximum reserve $0.65,
   explicitly accepting possible duplicate old work and retaining the $6.30 hold.
4. Same-UTC-day official price verification and unchanged final code/source,
   approval, parent lock, child journal and ledger admission snapshots.

No live permission or shutdown witness has been fabricated by the offline
implementation. A successful paid pilot would only be a raw-clip diagnostic.
The remaining nine clips require a separate later decision and reserve $5.45;
they do not run automatically after a pilot.

The separate architect decision is recorded in
`QA/evidence/live-current/video-recovery-live-pilot-decision.md`. It accepts a
conditional pilot scope only **after** the retrospective shutdown witness has
been independently verified. The original controller/shutdown sources still
need recovery and binding; this is the current live-execution blocker.

No default image/TTS model, cloud storage, browser journey, article repair,
publishing or global generation certification follows from these fixtures.
The overall media task remains incomplete pending actual native acceptance.
