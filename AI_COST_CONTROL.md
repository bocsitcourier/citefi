# AI Cost Control

**Final architect verdict: FAIL / NO-GO.** Latest hardening is not accepted.
Passed RLS 0030/0031/0032, legal queue-ID and billing debit-replay checks retain
their narrow evidentiary value, but they do not cover the release blockers
below.

## Cost boundary

Internal credits are not provider cost. The system must count **physical
provider submissions**, including submissions whose response is lost, separately
from credit reservations/debits. A one-credit debit with three physical Veo
submissions is still a cost-control failure.

No paid provider call or production mutation was performed in this audit. Cost
controls below are implementation findings, not proof of actual provider bills.

## Existing controls

### Admission

- Team paywall and entitlement checks precede principal paid routes.
- Usage caps reserve estimated spend.
- Credit reservations use a two-bucket allowance/purchased-credit model.
- Video routes have media/storage gates, per-user quota/concurrency slots and
  fixed credit menu costs.
- Batch generation estimates/reserves the selected article total.
- `assertRunBudget` applies operation-type ceilings before paid stages.
- Disabled media should be rejected before quota/cap/credit/slot consumption.

### Execution

- BullMQ queues bound attempts (commonly 2–3) and concurrency.
- Deterministic job IDs and tenant/run reservation IDs reduce duplicate
  execution.
- OpenAI SDK clients set `maxRetries: 0`, overriding the SDK default retry layer;
  queue/service logic is intended to own retries.
- Provider 429/5xx events contribute to a queue circuit breaker.
- Article hero reuse avoids a social image call when a usable parent image
  exists.
- Media generation can be disabled globally with
  `MEDIA_FEATURES_ENABLED=false`.

### Accounting

`cost_telemetry` captures operation/provider/model, attempt, duration, available
token or media usage, request/resource/job identity and success/failure.
`provider_usage_ledger`, credit ledger/reservations and usage events provide
separate views. Admin cost telemetry/openAI stats/quota APIs expose operational
data. Successful durable content debits reservations; final eligible failures
release them.

Migration 0031 repairs RLS drift by restoring ENABLE+FORCE on five generation
tables: the provider usage ledger, provider rates and versions, campaign ads and
ad approvals. Their ORM declarations explicitly enable RLS. Two schema tests and
the 5/5 provider-ledger DEV suite pass, including an ordinary tenant role being
unable to read another team's event after that test initially exposed the drift.
This is DEV evidence, not production migration proof.

## Known defects and leakage paths

1. The audit reproduced PostgreSQL `42P10` during a 280-article credit
   reservation because no matching tenant/run unique constraint existed.
   Migration 0030, Drizzle `unique()` shape, partial request-key index and a DEV
   EXPLAIN gate are applied in DEV. Eleven unit and six real-DEV-DB batch tests
   pass, including the exact 28-title, 280-credit, 10,000,000-balance fixture.
   The production batch processor test creates 28 rows and calls 28 fake child
   enqueues; it does not invoke AI. Do not infer production migration or
   live-generation safety.
2. BullMQ retry count multiplied by manual provider retry loops can exceed the
   apparent queue attempt count. Social variants, media helpers and all provider
   wrappers require a single computed physical-submission budget.
3. A crash after provider acceptance but before durable provider identity/output
   can repeat paid work while credit deduplication still shows one run.
4. Veo resolver validation is bypassed. An invalid/unavailable configured model
   can fail only after queue admission and reservation.
5. Cancellation and browser abandonment cannot reliably stop in-flight provider
   spend.
6. Some synchronous web API routes call models directly and use static resolver
   defaults. They do not receive the full worker retry/circuit/settlement policy.
7. Best-effort learning, metadata, critique and review passes add model cost.
   Their budgets must be included in the parent run, not treated as free.
8. Cost estimates in usage events (for example 5/8/15 cents or credit values) are
   product estimates, not reconciled provider invoices.
9. Current media hardening is **not accepted**. Eleven replay-safety fault tests pass, but
   Veo operation identity is not persisted before polling, no durable
   per-provider-entry lease prevents concurrent work after lock loss, Google SDK
   retry ownership is uncertified, and timestamp object names are not stable per
   attempt. Durable podcast queueing, reconciliation holds and singleton retry
   ownership in the tested OpenAI path do not provide a hard-kill provider
   journal; other paths use manual guards.

`debitReservation` now performs existing-job lookup before checking whether the
remaining reservation can cover the requested amount. Six concurrency tests
pass, including an 8-way same-job delivery and partial-debit replay. This
corrects the demonstrated narrow settlement replay guard in DEV test evidence; it does
not certify provider spend or production data.

Migration 0032 adds `reconciliation_required_at` and
`reconciliation_reason` without inventing a refunded/charged terminal state.
Accepted or ambiguous media work remains RESERVED pending explicit
reconciliation. Release logic refuses the marked hold, the sweeper skips it,
and entry guards stop another provider call for that run. The direct DEV DB log
records 14/14 reservation-state checks passing, including a stale flagged hold
surviving both direct release and the sweeper. The shared worker-handler fault
test performs zero automatic releases and marks reconciliation. This is not an
automatic reconciliation worker and does not prove provider acceptance or final
delivery.

The 11/11 media suite adds lower-level physical-attempt evidence against actual
wrappers with fake dependencies: `generateSingleImage` makes one SDK call for
timeout/missing-payload cases, `generateAndStoreHeroImage` makes one SDK plus one
storage attempt on storage failure, and `callOpenAI` makes three physical calls
for a 429 sequence under one retry owner. It does not close the crash window
between provider acceptance and writing a reconciliation flag on all paths.

Direct-image admission is not resource-wide. The preflight and claim are
separate, and claim uniqueness is only per version-derived run. Concurrent
requests with different versions can reserve and submit twice. The nine mocked
tests cover same-version/same-run concurrency, not this race. A lost HTTP
response after link+debit remains an additional duplicate-spend path.

Podcast can debit successfully and then fail to write its settled checkpoint.
The resulting cleanup/failed state can delete delivered media and retry paid
generation after `DEBITED`; READY settlement has the same post-debit checkpoint
window. Sweeper lookup uses obsolete `podcast:<articleId>` rather than the
hashed job identity; failed recovery is best-effort and failed state can permit
a new run, so it does not supply reliable settlement recovery.

Cap accounting has independent release blockers. Podcast's cap reservation ID
is not passed to the worker, leaving pending and completed amounts counted
together for its two-hour TTL. Direct image swallows `recordUsageEvent` failure
but then cancels the pending reservation, so completed spend may be absent from
the cap meter. Existing billing concurrency/debit-replay tests do not exercise
these cap paths.

Batch queue IDs now avoid the demonstrated invalid old `batch:280` form:
`batch-<id>` plus hashed article/image IDs are accepted and retrievable in one
isolated real-Redis test, while legacy lookups remain for rolling recovery.
Eleven unit tests cover static terminal replay behavior; six DB tests include
partial child-enqueue failure/retry to 28 unique accepted fake children. The
parent worker deliberately has no billing resolver, preserving the shared hold
for child settlement rather than releasing it on orchestration failure.

That terminal-replay conclusion is not accepted: ambiguous replay performs an
unconditional `QUEUED` update after reading queue state, allowing a concurrent
`RUNNING` or `CANCELLED` transition to be overwritten. Existing tests cover
static terminal input, not this check/update race.

Incident AI now routes through centralized `callOpenAI` and fails before the
provider unless it has a positive explicit/configured platform accounting team;
actor identity is threaded into telemetry. Nine provider-accounting boundary
tests pass. They are lower-level/static or simulated controls, not provider-bill
reconciliation.

## Required invariant per generation

Each run should expose:

| Field | Requirement |
|---|---|
| Identity | tenant ID, user ID, request/idempotency key, durable run ID, entity ID, BullMQ job ID |
| Admission | estimated max provider cost, reserved credits/cap, pricing/config version |
| Submission | provider, model, adapter version, physical attempt, provider request/operation ID, submitted timestamp |
| Result | usage units/tokens/seconds/images, provider-reported request ID, result checksum |
| Delivery | object key/checksum/size/content type, DB checkpoint, retrieval verification |
| Settlement | reservation status, debit/release keys and amounts, usage event, reconciliation status |
| Retry | error taxonomy, queue attempt, adapter attempt, next action, ambiguous flag |

Database uniqueness must be tenant scoped. Provider submission identity and
output checksum should be immutable. A retry may repeat polling/storage/debit but
must not repeat submission once acceptance is known.

## Attempt budget policy

Define a maximum **physical submissions per run**, not just retries per layer:

```text
remaining = runSubmissionCeiling
before each adapter request:
  atomically claim submission number
  if no budget: stop with BUDGET_EXCEEDED
after response:
  persist provider request/operation identity and usage
```

Disable SDK retries where orchestration owns retries (already done for OpenAI).
Gemini/Veo wrappers must make retry behavior explicit. Retry only transient
failures known to precede acceptance. A timeout after a non-idempotent request is
AMBIGUOUS until reconciled. Apply exponential backoff with jitter and circuit
breaking; never infinite retries.

## Media-specific controls

- Require configured durable storage before provider submission.
- Use stable run-derived object keys and checksums to make upload replay safe.
- Persist Veo `operation.name`; polling the same operation costs less and avoids
  duplicate generation.
- Acquire a durable tenant/run/provider-entry lease before each paid submission;
  BullMQ's lock alone is insufficient after a stall or lock loss.
- Derive stable attempt object keys rather than timestamps so an upload replay
  cannot multiply objects.
- Check cancellation before each clip/image/TTS call.
- Limit clip/image count, resolution, duration, prompt size and concurrent runs.
- Validate final bytes with image/media probes before debit and READY.
- Keep provider and composition costs distinct; delete temp files and sweep
  orphaned objects.
- Do not release credits merely because the browser disappeared.

## Release gates and dashboards

Production remains **NO-GO** until:

1. migration 0030 is proven in the deployed schema and reservation concurrency
   tests pass;
2. duplicate UI/API submission produces one run and one physical provider
   submission;
3. crash-after-submit tests prove checkpoint/reconciliation for each paid
   modality;
4. SDK + service + queue retry multiplication is measured;
5. telemetry totals reconcile to provider dashboards/invoices by model/day/team;
6. final objects are retrieved and validated, and external publication/export
   is confirmed where applicable;
7. per-team/day/month caps and emergency global media/provider kill switches are
   exercised.

Privacy scan status is dependency **0**, SAST **0**, privacy **1**, medium **2**,
low **0**. Because income, address and budget data can reach GenAI, data
minimization, retention, region and provider DPA review are required. Privacy
risk is also cost risk when oversized sensitive context is repeatedly sent.
