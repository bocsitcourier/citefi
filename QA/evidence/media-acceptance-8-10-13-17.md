# Media acceptance inventory: rows 8–10 and 13–17

## Execution

Command:

```text
node --import tsx/esm --test tests/qa/media-acceptance-8-10-13-17.test.ts
```

TAP output: [`accounting-execution/media-acceptance-8-10-13-17.new.tap`](accounting-execution/media-acceptance-8-10-13-17.new.tap)

The isolated run is green: **9 tests, 9 passed, 0 failed, 0 cancelled**, in about
5 seconds. It uses temporary filesystem storage, `sharp`, local
`ffmpeg-static`/`ffprobe`, and in-memory receipt/ledger dependencies. The
provider IDs are fixture IDs and the submit functions are fixture transports;
no provider SDK request, external media fetch, shared harness, customer
database, Redis, workflow, or publishing operation is used.

## Row disposition

| Row | Acceptance inventory | Evidence executed | Disposition |
|---:|---|---|---|
| 8 | Direct hero/media image | Production `runDirectImageOperation` + `executePaidMediaBoundary`; valid local PNG; fixture provider; temporary object-store roundtrip, stable URL, metadata, bytes/range, receipt and ledger settlement; cancellation and duplicate-attempt safety | **PASS — direct-operation service contract only; route/DB pipeline unverified** |
| 9 | Batch image/caption repair | Production caption sanitizer (normal, brand-token, truncation boundaries); production paid boundary exercises explicit provider rejection, post-success storage failure, and accounting failure; no replay after either durable-failure state | **PASS — repair/billing contracts; batch API route not exercised** |
| 10 | Identity-based social/media image regeneration | Production asset identity decoder and canonical object-key handling; malformed identity rejection and tenant/resource identity assertions | **PARTIAL — identity/media contracts; identity regeneration route and DB ownership query not exercised** |
| 13 | Social image | Production social-image normalizer; provider bytes are resized to the platform’s exact 1080×1080 PNG contract before storage; URL, metadata, bytes, receipt, ledger, and unsupported-platform rejection | **PASS — normalizer/boundary service contract only; social-generation route unverified** |
| 14 | Social slideshow video | Production FFmpeg compositor with five local 1920×1080 scenes and local six-second audio; persisted MP4 is probed for playback duration/resolution and read back through a byte range; stable storage URL and content metadata | **PASS — compositor/storage service contract only; provider-generation and route authorization unverified** |
| 15 | Idea video | Production paid video boundary with valid local MP4, one-submit receipt/ledger, concurrent duplicate recovery, and persisted bytes | **PARTIAL — paid-media safety seam; `veo-idea` provider/orchestrator route is not transport-injectable and was not called** |
| 16 | Like-this video | Same production paid video boundary checks as row 15, using a distinct like-video resource identity and fixture provider ID | **PARTIAL — paid-media safety seam; Veo/social orchestration route is not transport-injectable and was not called** |
| 17 | Podcast | Production duration preflight, fixture TTS renderer, `ffprobe`-authoritative 60-second metadata, production paid audio boundary, storage/export ZIP bytes, and `settleDeliveredPodcast` retry after post-success marker failure | **PARTIAL — audio/duration/billing/storage E2E; `generateArticlePodcast` DB/TTS orchestration route is not transport-injectable and was not called** |

## Recovery and accounting assertions

The suite asserts the requested failure properties rather than treating a
successful URL as sufficient:

- Every successful fixture media boundary has **exactly one provider submit**
  and **exactly one immutable-ledger capture**.
- A concurrent duplicate for both video rows produces one success and one
  receipt-owner conflict; it never submits a second provider request.
- Cancellation before provider acceptance is released as a confirmed
  pre-delivery failure; the test spy checks the reserved amount (`1`), team,
  user, run identity, reason, and exactly one release call, with zero provider,
  usage, or storage side effects.
- Row 10’s ownership fixture rejects both a wrong tenant and a wrong resource
  identity before receipt preparation; each rejection asserts zero provider
  submits, usage inserts, and storage writes.
- Explicit provider rejection is marked `provider_rejected`.
- A provider success followed by storage failure raises
  `ProviderResultNotDurableError`; retrying the same receipt raises
  `PROVIDER_ATTEMPT_ALREADY_SUBMITTED`.
- An immutable accounting outage raises the terminal
  `PROVIDER_ATTEMPT_ACCOUNTING_FAILED` error and does not replay the provider.
- Podcast settlement is retried after a post-success marker write failure;
  the audio provider remains at one submit.
- Receipt recovery reconciles the durable spool without another provider
  submit or another ledger insert.

## Deliberately unverified production layers

The direct production routes and worker orchestrators that depend on global
database/provider clients are not represented by fake route responses. In
particular, public-object authorization/published visibility, the batch repair
route, identity regeneration route, `veo-idea`/like-this orchestration, and
`generateArticlePodcast` remain unverified here because those modules do not
currently expose a fixture transport/storage/DB dependency seam. The table
therefore calls those rows **PARTIAL**, while the exercised production
service/adapters and their durable failure behavior remain explicit.