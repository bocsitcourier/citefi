# AI Architecture

## Audit status and evidence boundary

This document describes the repository as inspected on 2026-09-10, including the
working tree. It is not a production certification. No paid provider call or
production mutation was performed for this audit. Static inspection and
simulated-provider tests are not live end-to-end (E2E) evidence; final live text,
image, audio and video outputs remain unverified. **Final architect verdict:
FAIL / NO-GO.** Latest hardening is not accepted because code review found
five untested release blockers in batch replay, direct-image admission, podcast
post-debit settlement, podcast sweeper recovery, and cap accounting. This is in addition to the live
acceptance evidence described in `GENERATION_TESTING.md`. Existing lower-level
passes retain only their narrow evidentiary value.
Treat this document set as an incomplete audit checkpoint, not an accepted
hardening result or release recommendation.

Implementation labels used below:

- **Implemented**: an executable UI/API/service/storage path exists in this tree.
- **Partial**: executable pieces exist, but delivery, recovery, or acceptance is
  incomplete.
- **Unsupported**: a product concept or input exists without an executable final
  generation/delivery path. It must not be represented as implemented.

## Runtime topology

```text
Next.js/React UI
  -> authenticated Next route (team/role context, Zod/manual validation)
  -> PostgreSQL intent/status + credit/cap reservation
  -> BullMQ Queue in Redis (usually deterministic jobId)
  -> separate worker process (server/worker-process.ts)
  -> createPipelineWorker tenant/system execution boundary
  -> generator/orchestrator
  -> Gemini, OpenAI, Veo, local Sharp/FFmpeg, or publishing adapter
  -> deterministic validation
  -> PostgreSQL records + DigitalOcean Spaces objects
  -> authenticated API/status/object proxy
  -> UI retrieval, ZIP/CSV/HTML download, email, or supported publisher
```

`server/worker-process.ts` validates model tiers and then calls
`registerWorkers()` in `lib/worker.ts`. All current worker registrations use the
shared `createPipelineWorker()` policy in `lib/pipeline-worker.ts`: tenant or
audited system DB context, error classification, bounded retry disposition,
provider failure accounting/circuit breaking, final-attempt reservation release,
and special handling for durable output whose debit is still pending.

### Queue reality

BullMQ/Redis is the executable generation queue (`lib/queue.ts`) for batch,
article, social, image, reformat, social video, idea video, publishing, podcast,
brief, research and maintenance jobs. `pg-boss` 10.3.3 is still installed;
database fields, comments, process labels, and UI error text still call some job
IDs “pg-boss.” Repository search found no `new PgBoss` or `boss.work` runtime
construction. This is a **mixed migration footprint**, not evidence that two
independent queue engines currently consume generation work. Operations must not
infer queue ownership from legacy names.

BullMQ defaults retain 1,000 completed and 5,000 failed jobs. Most paid queues
use 2–3 attempts and exponential backoff. Job IDs deduplicate only while the
corresponding job remains in Redis; database run identity is the durable
arbiter.

## Data and storage

- PostgreSQL/Drizzle stores tenant-owned intents, state, generated text,
  metadata, variants, assets, approvals, usage, cost telemetry, learning events,
  publishing jobs, and credit reservations.
- New binary media uses DigitalOcean Spaces through the S3 SDK. Stable URLs are
  `/api/public-objects/<key>` rather than provider URLs. Private article/team
  prefixes are used, and `article_assets`/`social_post_assets` point to them.
- Read compatibility can fall back to the legacy Replit/GCS sidecar bucket until
  destination-matched migration evidence allows disabling legacy reads.
- Podcasts optionally back up to Google Drive; Drive failure is non-fatal and is
  not the delivery system of record.
- Images are processed with Sharp. Slideshow/social video composition uses local
  FFmpeg; generated MP4/audio/images are persisted before READY is returned.
- Veo provider result URLs are temporary inputs, not acceptable durable
  delivery. The application must download, validate and upload media to Spaces.

## Control planes

### Model routing

`lib/ai-config.ts` defines environment-overridable tiers.
`lib/model-resolver.ts` checks Gemini ListModels and OpenAI `/v1/models` at
worker startup and chooses a configured fallback. Critical text tiers can stop
worker startup if a reachable model catalogue has no candidate. Web-process
synchronous AI routes currently bypass strict readiness: `getModel()` warns and
returns the static default. This “Seam 3” compatibility behavior is partial
isolation, not a strict provider gateway.

Veo is deliberately excluded from resolver validation (`veoVideo: []`) because
it uses a separate endpoint. The configured Veo model is logged as “not
validated.” A green startup resolver therefore does **not** prove Veo exists,
the account can use it, or video generation works.

### Billing and cost

The intended order for paid async generation is:

```text
paywall/quota -> spending-cap reservation -> credit reservation
-> durable intent -> enqueue -> provider telemetry -> durable output
-> debit reservation -> usage event
```

`credit_reservations` is tenant/run scoped. The audit reproduced PostgreSQL
`42P10` while reserving 280 article credits because the required team/run
constraint was absent. Additive migration `0030_reservation_run_arbiter.sql`,
the Drizzle `unique()` constraint shape, and a migration `EXPLAIN` schema gate
have been applied in DEV. Current batch evidence is 11 passing unit tests and 6
passing real-DEV-database tests. The DB suite covers the exact 28-title,
280-credit fixture against a 10,000,000-credit balance and invokes the production
batch processor to create 28 article rows and 28 fake child enqueues. No child AI
provider ran, so this is not evidence that the migration is production-applied
or that article generation passed live E2E.

The batch API now persists submission identity, credit run ID, state and accepted
BullMQ job ID in `job_batches.generation_params.submission`. It atomically moves
`PENDING -> SUBMITTING`, records confirmed acceptance as `QUEUED`, and the worker
accepts `SUBMITTING` as well as `QUEUED`, closing the prior silent no-op race.
Same-key requests replay the durable response. If Redis acceptance remains
unknown after deterministic-ID lookups, batch state, credit hold and cap hold
are preserved for reconciliation rather than reset. The existing maximum of 100
selected titles remains; input validation trims/deduplicates titles and limits
each title to 255 characters.

This does not make ambiguous replay release-safe. After reading an allowed
retained queue state, the route unconditionally writes `QUEUED`. A concurrent
transition after the earlier terminal precheck can therefore regress `RUNNING`
or overwrite `CANCELLED`. The 11 unit, 6 DEV-DB and real-Redis ID tests do not
exercise this interleaving; “terminal states never resurrect” is not proven.

One isolated real-Redis integration test proves the installed BullMQ accepts and
can retrieve the new `batch-<id>` ID plus hashed article/image IDs, while the old
`batch:280` form is rejected. Runtime lookup helpers retain legacy IDs for
rolling recovery, including recovery-monitor paths. The batch parent worker has
no `getBilling` callback, so a parent orchestration failure does not release the
shared batch hold; child article outcomes own partial settlement/release. The
sixth DB test injects a partial child-enqueue failure and then retries to reach
28 unique accepted child identities.

Intercepted browser evidence shows two clicks in the same JavaScript turn emit
one request; the submit control disables while pending, clears the displayed
error for retry, and fits at a 375-pixel viewport. This validates client
interaction behavior only, not Redis, database, providers, or live generation.

`debitReservation` now performs idempotent job lookup before its remaining-hold
guard. Six concurrency tests pass, including eight concurrent deliveries of the
same job ID and replay of a partial debit after the remaining hold is smaller.
These database tests establish settlement behavior, not provider or delivery
certification.

Migration `0031_generation_rls_drift_repair.sql` restores both `ENABLE` and
`FORCE ROW LEVEL SECURITY` on `provider_usage_ledger`,
`provider_rate_versions`, `provider_rates`, `campaign_ads`, and
`campaign_ad_approvals`; the five ORM declarations also call `enableRLS()`.
The global schema policy gate and an ordinary-role other-team ledger read now
pass in DEV (the latter initially exposed the drift); 2 RLS-schema tests and the
5/5 provider-ledger suite pass. Migration `0032_reservation_reconciliation_hold.sql`
adds `reconciliation_required_at` and `reconciliation_reason`. Ambiguous or
accepted-but-undelivered paid work remains `RESERVED`, direct release is blocked,
the stale sweeper skips it, and provider-entry guards stop the same run before a
new call. These are reconciliation holds, not automated settlement or proof of
a durable provider-submission journal.

`cost_telemetry`, provider usage extraction, run ceilings, usage caps,
reservation sweeps, user video slots, and a Redis provider circuit breaker add
defense in depth. OpenAI clients set `maxRetries: 0`; queue/service policy owns
retries. Incident intelligence now uses `callOpenAI`, requires an explicit
positive accounting team (argument or `INCIDENT_AI_ACCOUNTING_TEAM_ID`), and
threads the actor user into accounting. The 9-test provider-accounting boundary
suite passes; this is static/simulated lower-level evidence, not a live incident
model call.

### Identity, tenancy and observability

Authenticated routes derive team/user context rather than trusting payload
ownership. Worker registrations declare tenant or system scope; entity/team
cross-checks fail unrecoverably. Durable statuses are exposed through entity
GET/status APIs. Cost telemetry records operation, provider/model, attempt,
request/resource IDs, duration and available usage. Job events, social logs,
error logs, notifications, health endpoints and worker heartbeat/readiness
provide operational evidence, but a health response is not output validation.

## Publishing and external delivery

Implemented publishing adapters exist for website, Facebook, LinkedIn and
TikTok and are invoked through `/api/publishing/jobs` and the
`content-publishing` worker. Connections, test calls, callbacks, job detail and
retry routes exist. Each external channel still requires valid OAuth/HMAC
configuration and live platform confirmation; code presence is not publication
evidence.

Campaign Google/Meta Ads are explicitly **export-only**. There is no Google Ads
or Meta Marketing API campaign/spend operation. Campaign ZIP exports and agency
report downloads/email are delivery paths, not ad publication.

## Known architectural gaps

1. Live final-output retrieval/playback/publication has not been proven.
2. Paid provider submission can succeed immediately before process death and
   before a durable checkpoint. Final media hardening keeps a Veo operation name
   in memory and may expose it through error/accounting paths, but does not
   persist it before polling. Without a durable provider operation/request
   identity, replay is ambiguous and may duplicate spend.
3. Veo startup validation is bypassed; provider capability is learned only when
   the path executes.
4. Cancellation generally changes application state; it cannot reliably abort
   an already-issued provider request. Browser abandonment does not cancel work.
5. BullMQ job IDs alone are not permanent idempotency keys after job removal.
6. Synchronous web-process AI calls still exist and can use unresolved defaults.
7. The pg-boss migration footprint makes runbooks and diagnostics ambiguous.
8. Privacy scan status is: dependency findings **0**, SAST **0**, privacy **1**,
   medium **2**, low **0**. Income, address and budget data may be sent to GenAI;
   DPA/data-processing and minimization review is required before production.

Current media replay-safety tests report **11 passing** in
`test-results/media-audit/reconciliation-replay-safety-final.tap`. These are
fault/simulation evidence, not paid live E2E. Hardening is not accepted:
podcast generation has a durable deterministic BullMQ queue path,
reconciliation holds block automatic release and sweeping, and the tested
OpenAI 429 path has one retry owner with three physical calls rather than
twelve. The tests also exercise the actual
`generateSingleImage` wrapper (one SDK call for timeout/missing-payload cases),
the actual `generateAndStoreHeroImage` path (one SDK call and one storage attempt
when storage fails), and a shared worker handler that marks reconciliation
without releasing credits. The direct DEV DB state suite reports 14/14 checks,
including a flagged stale hold surviving direct release and the sweeper.

`lib/direct-image-operation.ts` now wraps all three synchronous regeneration
routes (`/api/articles/[id]/regenerate-hero`,
`/api/content/[id]/regenerate-hero-image`, and
`/api/media/[id]/regenerate`). It uses authenticated tenant-owned resources,
canonical `section_regenerate` pricing and cap/credit reservation. Its atomic
provider-entry claim applies only to one run ID, not the canonical resource.
Resource-family preflight and claim are separate: two requests observing
different resource versions can both pass preflight, derive different run IDs,
claim independently and call the provider twice. The nine helper tests cover
same-version/same-run concurrency only, not this race. Owner-only clearing and
tenant-fenced linking are narrower controls, not a closed duplicate-submission
gap.

Direct image still has a post-commit response-loss gap: after resource linking
and debit commit, an HTTP response can be lost and a later request can start a
fresh generation because no durable successful-result replay response is
stored. Other modalities still have process-death windows around acceptance and
reconciliation writes. Equivalent provider-entry leases/resource-family guards
are not established for social video and standalone audio. There is no durable
per-provider-entry media lease or hard-kill journal, Veo operation identity is
memory-only before polling, Google SDK retry ownership is not certified, and
timestamped object keys are not stable per attempt. Lock loss can therefore
permit concurrent processors, and cancellation still cannot abort active
provider work.

Podcast has separate real-Redis evidence: one isolated test proves its
deterministic three-part job ID is accepted and an accepted `Queue.add` whose
acknowledgement is synthetically lost is recovered by lookup. If acceptance
cannot be determined, the helper marks reconciliation and the API returns HTTP
202 while retaining article lock, credit and cap. The worker writes status and
an error log and initiates notification before rethrow; its exact run guard
stops provider work on a reconciliation-marked reservation. This is not a live
Gemini/OpenAI/storage/retrieval test.

Podcast settlement/recovery remains unsafe. After debit succeeds, failure to
write `podcastBillingSettledAt` can clean up/delete delivered media, mark the
article failed and permit a paid retry despite a `DEBITED` reservation; the
READY settlement branch has the same post-debit checkpoint exposure. The stale
sweeper looks up legacy `podcast:<articleId>` rather than the accepted hashed
`podcast:<articleId>:<hash>` ID. Failed recovery/cleanup can be swallowed while
failed state permits a new run. Current tests do not cover these paths.

Cap accounting has two further blockers. Podcast does not pass its pending cap
reservation ID to the worker, so pending and completed usage can overlap for
the two-hour pending TTL. Direct image swallows completed-usage-recording
failure and still cancels the pending cap reservation, which can undercount
completed work. Billing debit-replay tests do not cover either defect.
