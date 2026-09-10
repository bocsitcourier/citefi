# Generation Pipelines

## Reading this inventory

Routes and files are exact repository paths. “Implemented” means code exists,
not that a live provider or final asset passed E2E. This audit made no paid call
and no production mutation. Static and simulated tests cannot establish live
provider compatibility, object integrity, playback, publishing, or export
usability.

**Final architect verdict: FAIL / NO-GO.** Latest hardening is not accepted.
Passing RLS/migration, legal-queue-ID and debit-replay evidence remains valid
only for those narrow assertions; current tests omit the blockers below.

## Generation and transformation matrix

| Capability | UI -> exact API | Worker/service -> provider | Persistence -> retrieval/export | Status and limits |
|---|---|---|---|---|
| Title pool | batch selection (`app/batches/[id]/select/page.tsx`) -> `GET /api/jobs/title-pool` | synchronous title/research services -> Gemini text | batch/title pool in PostgreSQL -> selection UI | **Implemented, live unverified.** |
| Batch articles/blog/SEO | batch pages -> `POST /api/jobs/batch-submit`; regeneration -> `POST /api/articles/[id]/regenerate` | BullMQ `batch-generation` -> child `article-generation` -> `processArticleGenerationJob`, enhanced article/critique/review stack -> Gemini + OpenAI | `job_batches.generation_params.submission` stores idempotency/credit-run/state/job identity; `job_batches`, `articles`, runs/events; HTML, SEO fields and assets -> `/content/[id]`, `/api/articles/[id]`, `/api/export/batch/[id]` | **Implemented, release blocker.** Ambiguous replay reads an allowed retained queue state and then unconditionally writes `QUEUED`; a concurrent transition after terminal precheck can regress `RUNNING` or overwrite `CANCELLED`. The 11 unit + 6 DEV-DB tests and one real-Redis legal-ID test do not cover this race or an AI provider. |
| Article title regeneration | batch UI -> `POST /api/batches/[id]/regenerate-titles` | synchronous title generator -> Gemini | article chosen titles / batch state -> batch UI/export | **Implemented, live unverified.** |
| Article metadata | content editor -> `POST /api/content/[id]/regenerate/seo-title`, `POST /api/content/[id]/regenerate/meta-description`, `POST /api/content/[id]/regenerate/keywords`, `POST /api/content/[id]/regenerate/slug`, `POST /api/content/[id]/regenerate/faq`, and `POST /api/content/[id]/regenerate/hashtags` | `lib/seo-regenerator.ts` and related services -> Gemini/OpenAI according to method | article metadata columns -> `GET /api/articles/[id]`, content UI and exports | **Implemented, live unverified.** These are the exact nested route folders in the repository. Separate synchronous calls can spend outside a queue retry boundary. |
| Article formatting/hyperlinks | content UI -> `POST /api/articles/[id]/reformat`, `/apply-hyperlinks`; batch repair routes | BullMQ `article-reformat` or synchronous hyperlink/review services -> OpenAI/Gemini plus deterministic cleaners | article HTML/link fields -> content UI/export | **Implemented, live unverified.** |
| Article hero/body images | direct regeneration -> `POST /api/articles/[id]/regenerate-hero`, `POST /api/content/[id]/regenerate-hero-image`, `POST /api/media/[id]/regenerate`; batch repair -> `/api/batches/[id]/regenerate-images` | three direct routes use `runDirectImageOperation` -> Gemini image; batch path uses BullMQ `image-generation`; Sharp conversion/validation | direct helper tenant-fences final article/asset link then debits; Spaces object + `article_assets`, `articles.heroImageUrl` -> object proxy/content/export | **Implemented, release blocker.** Claim/flag is atomic per run, not per resource. Different resource versions derive different runs, so concurrent preflights can both pass and submit two provider calls. Nine mocks cover same-version concurrency only. Completed usage-record failure is swallowed while the pending cap is cancelled, allowing undercount. Post-link/debit response replay is also absent. |
| Article -> social | content UI -> `POST /api/articles/[id]/social-posts`, then normal social APIs | creates linked social intent; BullMQ social worker -> Gemini draft, critic, OpenAI enhancement | `social_posts`, variants/assets/logs -> `/social/[id]`, social APIs | **Implemented, live unverified.** |
| Social variants/captions/hashtags | social create -> `POST /api/social_posts/generate`; per-variant -> `POST /api/social-posts/variants/[variantId]/regenerate` | BullMQ `social-post-generation`; Gemini caption then OpenAI enhancement; deterministic platform limits | `social_posts`, `social_post_variants`, logs -> `GET /api/social_posts/[id]` and UI | **Implemented, live unverified.** Platforms in generator: X, Facebook, Instagram, LinkedIn, Pinterest. At least one successful variant permits parent READY; individual failures remain visible. |
| Social image | social generation with `includeImage` | reuse linked article hero at zero provider cost; otherwise Gemini social image generator | `social_post_assets`, Spaces or reused URL -> social detail/export | **Implemented, live unverified.** Reuse accepts only an HTTP-prefixed hero in this path. |
| Social slideshow video | social detail/create -> `POST /api/social/video/generate` or `/batch`; cancel -> `/cancel` | BullMQ `social-video-generation` -> Gemini script + five Gemini images + OpenAI TTS in parallel -> FFmpeg compose + GPT metadata | script/status on `social_posts`; image/video assets + Spaces MP4 -> status/detail/object proxy/campaign ZIP | **Implemented, live playback unverified; replay hardening partial.** Three queue attempts. Cancel marks application state but cannot retract calls already sent. No durable per-provider-entry lease protects against concurrent processors after lock loss. |
| Idea video | idea-video UI -> `POST /api/social/video/idea`, then `POST /api/social/video/idea/[id]/generate` | BullMQ `video-idea-generation` -> Gemini expansion/script/critic -> Veo clips + OpenAI TTS/local stitching | `video_ideas` concept/script/progress/video URL and Spaces media -> `GET /api/social/video/idea/[id]` | **Implemented, live playback unverified; replay hardening partial.** 3 attempts, 60s exponential base, concurrency 5. Resolver does not validate Veo. Veo operation identity remains memory-only until error/accounting rather than durably checkpointed before polling. |
| “Like this video” | idea-video UI -> `POST /api/social/video/like`, `POST /api/social/video/like/[id]/analyze`, then `/generate` | external URL validation/style analyzer, then same idea/Veo pipeline with style prompt | `video_ideas` style analysis + result -> idea status UI | **Partial/live unverified.** Analysis does not itself create a video. External media access and rights remain caller responsibilities. |
| Podcast script + audio | content page -> `POST /api/podcast/generate`; poll `GET /api/podcast/status/[id]` | deterministic three-part BullMQ `article-podcast` job -> Gemini podcast script/critic -> OpenAI TTS segments -> MP3 merge; optional Drive backup | article podcast/error fields + `article_assets`, Spaces MP3 -> status/content/object proxy | **Implemented, release blocker.** Real Redis proves hashed job add/lost-ack lookup only. Main-path post-debit checkpoint failure can delete delivered media; both it and READY settlement can mark failed and retry paid work after `DEBITED`. Sweeper uses obsolete `podcast:<articleId>` rather than the hashed ID; failed recovery is best-effort and failed state can allow a new run. Worker lacks the pending cap reservation ID, so pending and completed usage overlap for two hours. Existing tests do not cover these paths. |
| Daily briefs | brief settings/admin -> `POST /api/briefs/generate-me` or admin `/generate-now` | BullMQ `daily-brief` -> daily brief worker and AI/research services | brief tables -> `/api/briefs/today`, admin/preferences/viewed routes | **Implemented, live unverified.** Deterministic user/date job ID except forced generation. |
| Campaign planning/bundling | `/campaigns/new`, `/campaigns/[id]` -> `/api/campaigns`, `/api/campaigns/[id]`, confirm-brand | `campaign-service`, brand intelligence/research queue; recommended article/social/video bundles | campaigns, snapshots and linked content -> campaign detail and ZIP | **Implemented orchestration, not one monolithic generator.** A campaign links/exports assets generated by their own pipelines. |
| Campaign Ads Lab | campaign detail -> `POST/GET /api/campaigns/[id]/ads`; approval and ad export routes | synchronous `campaign-ads-service` -> Gemini JSON; deterministic Google RSA/Meta validation, landing-page fetch, human approvals | `campaign_ads`, approvals, immutable manifest/hash -> authorized ZIP/CSV through `/ads/[adId]/export` | **Implemented export-only, live unverified.** No external ad API, campaign creation, spend, or publication. UI/API return `mode: export_only`, `directPublishing: false`. |
| Campaign export/repurposing bundle | campaign UI -> `GET /api/campaigns/[id]/export` | no new provider call; loads linked article/social/video | streamed ZIP with article CSV/social/video and manifest; `campaign_exports` audit | **Implemented export, download unverified.** This is bundling, not semantic long-form-to-every-channel generation. |
| Journeys | journeys UI -> `/api/journeys`, `/[id]`, `/trigger`; recommendation APIs `/api/journey/next`, `/convert`; batch `/launch-journey` | policy/orchestrator and BullMQ journey scheduler; associates scheduled steps/content | journeys/steps/policies/conversions -> journey UI/stats | **Partial.** Scheduling, context and conversion logic exist; repository inspection did not find a journey step directly enqueueing an asset generator, and email content delivery is not demonstrated. |
| Publishing | settings publishing UI -> `POST /api/publishing/jobs`; detail/retry routes and callbacks | BullMQ `content-publishing` -> website/Facebook/LinkedIn/TikTok adapters | connections, publishing jobs/status/errors -> job UI/API and remote platform IDs | **Implemented adapters, live publication unverified.** Queue acceptance is not publication. No X, Instagram, Pinterest or YouTube publisher adapter was found. |
| Agency reports | agency report UI -> `POST /api/agency/reports/generate`, approve/send/download routes | deterministic DB evidence assembly and renderer; email service for approved report | immutable report/financial snapshots and delivery audit -> client-safe HTML download/portal/email; agency rebilling CSV | **Implemented, not AI generation.** Delivery unverified; client projection excludes provider/model/cost/internal fields. |
| Learning/decisioning | `/learning` -> `/api/learning/{feedback,engagement,intelligence,strategy,patterns,optimization,mine-corpus,...}` | learning, scoring, cohort mining, generation critic and Thompson/Wilson services; some analyses use model calls | learning events/patterns/arms/reviews -> learning UI and prompt enhancements | **Implemented feedback infrastructure, effectiveness unverified.** Several generator integrations catch learning failures as non-fatal; only call sites present in the repository are claimed. |
| Reports/analysis | admin SEO/incident reports and agency report APIs | deterministic aggregation; incident intelligence calls centralized `callOpenAI` with schema validation and explicit configured/platform accounting team plus actor user | DB reports/logs -> admin/client download/UI | **Mixed.** Agency reports are deterministic. The 9-test accounting-boundary suite is lower-level/static or simulated evidence, not a live incident-AI E2E call. |

## Explicitly unsupported or only implied

- **Landing-page generation:** absent. Campaign Ads Lab validates and fetches an
  existing HTTPS landing URL; `landingPageUrl` fields are inputs/links. No route
  generates or hosts a landing page.
- **Email campaign copy/generation and marketing automation:** absent as a
  generator. Transactional/report email and journey concepts exist, but no
  executable AI email-campaign asset pipeline was found.
- **Google Ads/Meta live publishing or spend:** absent by policy; export only.
- **Image editing/inpainting:** no provider-backed image-edit contract was found.
  Regeneration and local resize/compose are not editing.
- **RSS podcast publishing, multi-host distribution, background music, audio
  mastering:** absent.
- **End-to-end “article -> social -> video -> podcast -> email -> ads” one-click
  flywheel:** individual transformations exist, but no atomic orchestrator proves
  every hop and final delivery.
- **Publisher channels X, Instagram, Pinterest, YouTube, Threads:** generators
  may create some social text variants, but no corresponding live adapters were
  found. Threads/YouTube generation contracts were not found.
- **Veo cancellation:** application cancellation cannot revoke an already
  submitted long-running provider operation.

## Retrieval acceptance

A pipeline is complete only when a tenant can later retrieve the exact durable
record and, for media, the authenticated object proxy returns a valid playable
file. For publication/export, the remote acknowledgement or downloaded archive
must be inspected. Neither a 200 response, Redis job ID, READY row, simulated
provider, nor preview alone satisfies that contract.

The current media replay-safety suite records 11 passing tests in
`test-results/media-audit/reconciliation-replay-safety-final.tap`; those tests
use fake providers/faults and are not paid live E2E. Reconciliation holds,
podcast durable queueing and singleton ownership of the tested OpenAI 429 retry
path are partial improvements. Lower-level evidence includes one actual
`generateSingleImage` SDK call per timeout/missing-payload case, one SDK plus one
storage attempt for an actual `generateAndStoreHeroImage` storage failure, three
physical calls for an actual `callOpenAI` 429 sequence, and 14/14 direct-DB
reservation checks. It does not retrieve a live generated asset.

Direct-image preflight does not atomically claim a resource family: only each
version-derived run is claimed. Podcast debit/checkpoint cleanup, stale-sweeper
ID and cap-lifecycle defects remain open. Social video and standalone audio also
lack a universal entry lease; Veo identity remains memory-only before polling,
Google SDK retry ownership is uncertified, timestamp object names are unstable,
and no hard-kill provider journal exists. Hardening is not accepted and all
media pipelines remain production NO-GO.
