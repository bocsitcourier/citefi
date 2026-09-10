# AI Provider Matrix

## Configured model tiers

Authoritative runtime defaults come from `lib/ai-config.ts`; runtime resolution
comes from `lib/model-resolver.ts`.

| Tier | Default | Resolver fallback chain | Main uses |
|---|---|---|---|
| `geminiFlash` | `gemini-3.5-flash` | `gemini-3.5-flash` -> `gemini-2.5-flash` -> `gemini-2.5-flash-preview-04-17` | social/text, briefs, analysis, ads |
| `geminiArticle` | `gemini-3.5-flash` | same flash chain | article drafting |
| `geminiPro` | `gemini-3.1-pro-preview` | configured pro -> `gemini-2.5-pro` -> `gemini-3.5-flash` | higher-reasoning/research |
| `geminiCritique` | `gemini-2.5-flash-lite` | configured lite -> `gemini-3.5-flash-lite` -> `gemini-3.5-flash` | critique |
| `geminiImage` | `gemini-2.5-flash-image` | configured image -> `gemini-3.1-flash-image` -> `gemini-2.5-flash` | article/social/slideshow imagery |
| `veoVideo` | `veo-3.1-fast-generate-preview` | none; validation bypassed | generated video clips |
| `gptMini` | `gpt-4.1-mini` | configured -> dated `gpt-4.1-mini-2025-04-14` -> `gpt-4o-mini` | enhancement/review/metadata |
| `gptReview` | `gpt-4.1-mini` | same mini chain | review |
| `gptAdvanced` | `gpt-4.1` | configured -> dated `gpt-4.1-2025-04-14` -> `gpt-4o` | advanced review/reasoning |
| `gptHyperlinkExtract` | `gpt-4.1-mini` | mini chain | link extraction |
| `gptHyperlinkCorrection` | `gpt-4.1-mini` | mini chain | link correction |
| `tts` | `gpt-4o-mini-tts`, voice `coral` | only `gpt-4o-mini-tts` | podcasts and video narration |

Every default is environment-overridable. The comments in `ai-config.ts` claim
live verification in August 2026, but those comments are historical evidence,
not a current provider guarantee. The resolver’s hard-coded shutdown map is also
not authoritative; deprecation dates must be refreshed from the provider table
before release.

## Provider and dependency map

| Provider/system | SDK/API | Executable capabilities | Validation/storage | Retry ownership and replacement risk |
|---|---|---|---|---|
| Google Gemini Developer API | `@google/genai` 1.27; `models.generateContent`; REST ListModels | article/title/SEO/social/script/brief/research/critique/ads; native image output | JSON/contract and deterministic validators; images converted/validated then Spaces | Startup catalogue resolution for Gemini tiers, but synchronous web calls can use static defaults. Many direct call sites make full replacement non-trivial despite central model IDs. |
| Google Veo | `@google/genai` long-running `generateVideos` flow | idea/video clips and Veo social video paths | downloaded media must pass guards and be uploaded; operation name is currently memory-only until error/accounting, not persisted before polling | **No startup model validation/fallback.** Paid submission crash ambiguity is highest risk. Google SDK retry ownership is not certified; no durable checkpoint or provider-entry lease can be claimed. |
| OpenAI | `openai` 6.7; centralized `callOpenAI` chat completions and `audio.speech.create` | enhancement/review/hyperlinks/SEO metadata, podcast/video TTS, incident analysis | structured parsing and downstream contracts; audio merged, validated and uploaded; incident advice requires an explicit accounting team and actor identity | SDK `maxRetries: 0`; the tested `callOpenAI` 429 path has one owner and exactly three fake physical calls, not twelve. Other call paths still require retry-budget review. |
| DigitalOcean Spaces | AWS S3 SDK | durable image/audio/video object storage | Head/read through `/api/public-objects`; DB asset pointers | Not an AI provider. Storage failure after provider success is a paid-result crash window; compensation/checkpoint behavior differs by pipeline. |
| Legacy Replit object storage | `@google-cloud/storage` sidecar federation | read-only historical compatibility | fallback reads gated by migration evidence | Must not receive new writes. Removal requires destination-matched migration evidence. |
| Google Drive | `googleapis` | optional podcast backup/export integrations | provider file ID; failures are non-fatal | Not system of record; backup success does not prove user retrieval. |
| Website/Facebook/LinkedIn/TikTok | publishing adapters | external content publication | publishing job/callback/remote response | Credentials and live confirmations unverified. Adapter presence is not channel certification. |
| Google Ads/Meta Ads | none | **No direct publishing** | approved immutable ZIP/CSV manifest only | Export-only by launch policy. |
| Local media | Sharp, FFmpeg, ffprobe | conversion, image sizing, slideshow composition, stitching, media probing | local/file guards then Spaces | CPU/disk/process limits matter; local success still requires durable upload and later retrieval. |
| Email | Nodemailer/delivery service | transactional and approved agency-report email | append-only delivery records | Not an AI email campaign provider. Deliver-before-audit ambiguity is reduced with claims/locks but live delivery is unverified. |

## Resolver behavior and caveats

1. Worker startup fetches Gemini ListModels and OpenAI `/v1/models` with 10s
   timeouts. If the catalogue call fails, the worker trusts configured values.
2. Critical tiers are Gemini flash/article/pro and OpenAI mini/advanced. Image,
   critique, TTS and Veo are not startup-fatal.
3. Mid-flight model-not-found can trigger re-resolution where callers use
   `reResolveAfterModelNotFound`; this is not a universal transparent replay.
4. Veo appears in the Gemini configured-model status list, but the resolver does
   not run a Veo-specific capability request and leaves its chain empty. Treat
   Veo health as unknown until a safe canary/live pipeline proves it.
5. A fallback model may differ in output schema, context, modality or price.
   Availability alone is insufficient; each fallback needs contract fixtures
   and bounded canary acceptance before production routing.

## Evidence status

No provider in this matrix was paid-live-E2E certified by this documentation
task. Static call-site inspection and simulated faults establish intended
control flow only. Production remains **NO-GO**, and final generated outputs,
storage retrieval, media playback and external publication are unverified.
**Final architect verdict is FAIL; latest hardening is not accepted.**
This verdict does not erase the narrow passing evidence for migrations
0030/0031/0032, legal BullMQ IDs, or billing debit replay; those controls simply
do not cover the blockers below.
The current media fault suite has 11 passing tests
(`test-results/media-audit/reconciliation-replay-safety-final.tap`), but this
proves partial fake-provider/guard behavior only. Podcast queue identity,
reconciliation holds and the tested singleton OpenAI retry owner do not solve
the missing durable provider journal, provider-entry lease, stable attempt
object identity, Google SDK retry certification, or hard cancellation. The
suite calls the actual `generateSingleImage`, `generateAndStoreHeroImage`, and
`callOpenAI` wrappers with fake SDK/storage failures: observed counts are one
image SDK call per timeout/missing-payload case, one image SDK plus one storage
attempt on storage failure, and three OpenAI physical calls for 429. These are
not live-provider compatibility results.

Reconciliation remains modality-incomplete. The direct-image claim is atomic
only for one version-derived run, not the canonical resource: different-version
requests can both pass preflight and call Gemini. Its nine mocks cover
same-version concurrency only, and cap usage can be undercounted when completed
recording fails but pending reservation cancellation still runs. Podcast's
post-debit checkpoint failure can clean up delivered audio, mark failed and
retry paid work after `DEBITED`; READY has the same checkpoint exposure. Its
sweeper uses the obsolete un-hashed job ID; failed recovery is best-effort and
failed state can allow a new run. Pending/completed cap usage can double count
for two hours because the worker lacks the cap reservation ID.
Current tests cover none of those release blockers. Batch additionally has an
unconditional `QUEUED` replay write that can regress `RUNNING`/`CANCELLED`.
Social/standalone media leases and Veo's durable operation checkpoint remain
absent.

Provider-accounting storage also has lower-level DEV evidence: migration 0031
restores ENABLE+FORCE RLS for the provider ledger/rate tables and campaign
ad/approval tables, ORM definitions explicitly enable RLS, 2 schema tests pass,
and the 5/5 provider-ledger suite includes an ordinary tenant role unable to read
another team's event. That cross-tenant test initially failed before the drift
repair. This does not establish production migration state.
