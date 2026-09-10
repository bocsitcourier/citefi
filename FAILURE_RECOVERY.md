# Failure Recovery

**Final architect verdict: FAIL / NO-GO.** Latest hardening is not accepted.
The failure paths below remain reproducible from code inspection and are not
covered by the passing lower-level suites. The narrow 0030/0031/0032,
legal-queue-ID and billing-debit-replay results remain passed; they do not
resolve these failures.

## Recovery contract

Recovery must preserve four independent truths:

1. whether a provider submission physically occurred;
2. whether a valid output was obtained and durably stored;
3. whether credits/caps were settled;
4. whether the user can retrieve/export/publish that output.

Collapsing these into one `success` flag causes duplicate paid submissions,
false refunds, or false delivery. A queue acknowledgement is not provider
success; provider success is not durable delivery; READY is not external
publication.

## Current mechanisms

- BullMQ jobs use bounded attempts and exponential/fixed backoff. The shared
  `createPipelineWorker` classifies errors and skips retries for fatal errors.
- Deterministic IDs cover many batch/article/image/podcast/video/publishing jobs.
  Ambiguous enqueue handlers re-read Redis before writing FAILED_ENQUEUE.
- Worker entity/team checks are fatal and do not touch possibly foreign billing.
- Provider 429/5xx failures feed a Redis circuit breaker.
- Run budgets are checked inside processors so domain status cleanup runs before
  final reservation release.
- Reservations release only on a final non-billing/non-lease/non-tenant failure.
  `DEBIT_FAILED` preserves a durable delivered result and retries settlement.
- Podcast/social/idea-video READY checkpoints avoid content regeneration when
  only debit settlement failed.
- Migration 0032 adds reconciliation timestamp/reason fields. A marked
  reservation stays `RESERVED`; direct release and the stale sweeper preserve
  it, and provider-entry guards reject reuse of that run pending explicit
  reconciliation.
- Storage/database cleanup attempts remove orphan records/objects on selected
  podcast/media failures; sweepers exist for reservations and video orphans.
- Graceful worker shutdown drains for 30 seconds by default. Force close cannot
  cancel an already-issued provider request.

## Failure matrix

| Failure point | Required state and response | Current assessment |
|---|---|---|
| Validation/auth/paywall before reservation | 4xx; no queue/provider call or debit | Implemented across principal paid routes, but must be route-by-route tested. |
| Reservation conflict | return existing same-tenant run or explicit failure; never spend | Team/run arbiter was missing and reproduced PostgreSQL `42P10` at 280 credits. Current evidence: 11 unit + 6 real-DEV-DB batch tests, 2 reservation-schema tests and 6 billing concurrency tests pass. The exact fixture is 28 titles/280 credits against a 10,000,000 balance. Production schema/live generation remain unverified. |
| Queue write definitely rejected | release holds, then make retryable | Batch compensation releases credit/cap before returning to `PENDING`; a failed credit release keeps it non-retryable. Other key queues vary. |
| Queue write response ambiguous | poll deterministic job ID; preserve intent and holds if still unknown | **Blocker:** batch pending replay checks queue state, then unconditionally writes `QUEUED`. A concurrent `RUNNING`/`CANCELLED` transition after the earlier terminal check can be regressed. Existing 11 unit/6 DB/real-Redis tests omit this interleaving. Podcast HTTP 202/lost-ack evidence does not cover settlement recovery. |
| Duplicate delivery/double click | same tenant/run and same physical provider submission | **Blocker:** direct-image claim is per version-derived run, not atomic per resource; two different-version requests can both pass preflight and call the provider. The nine mocks test same-version concurrency only. |
| Provider 400/401/403/model missing | fatal, human-readable configuration/model error; no blind retry | Shared taxonomy exists. Veo model validation is bypassed at startup. |
| Provider 429/5xx/timeout before known acceptance | bounded exponential retry with breaker | Implemented generally, but nested service + queue retries can multiply attempts. |
| Provider accepted, response lost | reconcile by durable provider request/operation ID; do not blindly resubmit | **Gap.** Text/image/TTS often lack a provider recovery handle. Current media guards do not create a universal durable checkpoint. |
| Veo operation running during crash | persist `operation.name`, reconstruct operation after restart, then poll/download | **Gap.** Final changes keep the name in memory until error/accounting but do not persist it before polling. No durable checkpoint may be claimed. |
| Provider output obtained, storage fails | checkpoint provider identity/result where recoverable, retry storage only or quarantine for manual recovery | Podcast raises non-replayable `ProviderResultNotDurableError` after paid audio; other media behavior varies. Automatic replay can duplicate spend if no checkpoint exists. |
| Object stored, DB write fails | retry DB with same object key or delete verified orphan; record ambiguity | Compensating cleanup exists in some pipelines, not globally atomic. |
| Output READY, debit fails | preserve READY/output; retry debit only, never provider | **Podcast blocker:** debit can succeed and the following billing-checkpoint write can fail. Main-path cleanup can delete delivered media and mark failed; READY settlement has the same post-debit write exposure. A retry can regenerate after the reservation is already `DEBITED`. |
| Usage telemetry fails after provider call | retain the hold and require reconciliation; never silently lose provider cost | Provider accounting errors are fatal/non-replayable and can mark reconciliation. Nine provider-accounting boundary tests pass, but every call site still requires live certification. |
| User cancels | stop unsubmitted stages; mark cancelling/cancelled only after worker observes; account for already-spent calls | **Partial.** Social video uses cooperative status checks. Provider calls already in flight cannot generally be aborted. |
| User closes browser/abandons page | job continues; status/retrieval must be durable | Intended async behavior. Abandonment is not cancellation and currently offers limited user control over paid work. |
| Worker stalls/process dies | BullMQ returns stalled work to waiting subject to limits; processor must be idempotent | Queue supports recovery, but paid calls are not inherently idempotent. |
| External publication uncertain | retain pending/unknown; query remote platform before retry; never say published | Publishing job model exists; live channel behavior unverified. |
| Export/download interrupted | regenerate deterministic archive; audit idempotently; no external publication claim | Campaign export does this. Actual downloaded archive unverified. |

## Crash windows for paid work

The dangerous sequence is:

```text
provider accepts paid request
  -> process dies before provider request/operation ID is durable
  -> BullMQ marks job stalled/retries
  -> provider receives a second paid request
```

Credits and provider spend are different ledgers. A unique credit reservation
prevents a second internal debit; it does **not** prevent a second physical
provider submission. Every paid adapter needs a submission record committed
before or immediately with the provider handle, attempt number, status
`SUBMITTING|SUBMITTED|RESULT_OBTAINED|DURABLE|AMBIGUOUS`, and a reconciliation
path. If the provider does not support idempotency/retrieval, an ambiguous
outcome should stop automatic retry and require operator action.

For Veo, persist `operation.name` as soon as returned. On restart reconstruct a
`GenerateVideosOperation`, poll it, download promptly, validate and upload to
Spaces. Google states generated Veo videos are retained for only two days, so a
provider URL/operation is not durable storage.

The current media fault suite reports 11 passing tests in
`test-results/media-audit/reconciliation-replay-safety-final.tap`, but these use
fake SDK/provider faults, are not paid live E2E and do not close the crash
window. Podcast now uses deterministic durable queue identity, and the tested
OpenAI 429 path has one retry owner and three fake physical calls rather than
twelve. Actual production wrappers were invoked with fake dependencies:
`generateSingleImage` made one SDK call in timeout/missing-payload cases, and
`generateAndStoreHeroImage` made one SDK and one storage attempt before the
injected storage failure. The shared handler made no automatic reservation
release and marked reconciliation. The direct DEV DB state suite reports 14/14,
including a flagged stale hold surviving direct release and sweeping.

Reconciliation markers keep accepted/ambiguous runs held only after the marker
is durable. Direct image does not atomically claim the resource family:
preflight is separate and claim scope is one run ID, so different versions can
submit concurrently. Podcast settlement recovery is also unsafe: the sweeper
constructs legacy `podcast:<articleId>` while actual jobs are
`podcast:<articleId>:<hash>`; failed recovery/cleanup can leave failed state that
permits a new paid run. These defects are not in the nine image mocks, podcast
Redis test, 11 media faults, or 14 DB checks. There is still no general provider
journal/entry lease, Veo identity is memory-only, SDK retry ownership is
uncertified, and timestamp object keys are unstable.

Cap failure handling adds two blockers. Podcast does not propagate its pending
cap reservation ID to the worker, so the pending reservation and completed
usage event coexist until the two-hour TTL. Direct image catches completed
usage-record failure but still cancels its pending reservation, so completed
provider work can disappear from the cap meter.

Batch child orchestration also now has explicit retry evidence: the parent has
no billing callback and retains the shared hold, while an injected partial child
enqueue failure returns the batch to `QUEUED`; retry fills the gap to 28 unique
accepted child IDs. New legal IDs are `batch-<id>` and hashed article/image IDs,
with legacy lookups retained for rolling recovery.

Settlement recovery has separate database evidence: `debitReservation` now
checks an existing job debit before enforcing the remaining-hold guard, and 6
concurrency tests pass. They include eight concurrent calls with one job ID and
a partial-debit replay after the hold has fallen below the original amount.

## Cancellation and abandonment limitations

- BullMQ removal or worker connection close does not retract HTTP requests
  already delivered to Gemini/OpenAI/Veo.
- Cooperative cancellation checks must occur before each paid stage and before
  marking READY, but cannot guarantee refund once a provider accepted work.
- A browser disconnect must never release a reservation while its durable job is
  active.
- Current cancellation can mark the database `FAILED` while an active provider
  request continues; it does not abort that request.
- “Cancel requested” and “cancelled before provider submission” are distinct.
  UI must disclose when spend may already have occurred.
- Retry/abandon controls for idea video and other long media are incomplete; an
  operator needs a safe reconcile/settle/release decision rather than arbitrary
  requeue.

## Operational response

1. Pause the affected queue/circuit, not all generation, when systemic provider
   failures occur.
2. Locate tenant ID, run/reservation ID, BullMQ job ID, provider attempt/request
   ID, telemetry, entity status and object key.
3. Never manually requeue a paid job until submission ambiguity is resolved.
4. If durable output exists, settle billing and restore retrieval; do not call
   the provider.
5. If no output and provider proves no acceptance, release/retry under the same
   run ID.
6. If acceptance is unknown, set the reconciliation timestamp/reason, preserve
   the RESERVED hold, block provider re-entry and stale sweeping, and escalate
   for an explicit settle-or-release decision.
7. Verify object bytes/playback and tenant retrieval before closing an incident.

No live failure drill was executed for this documentation task. Production is
**NO-GO** until crash, stalled, duplicate, storage-failure, debit-failure,
cancellation and retrieval drills pass without paid amplification.
