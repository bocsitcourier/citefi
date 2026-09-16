# Future Proofing

**Final architect verdict: FAIL / NO-GO.** Stop promotion of the latest
hardening. The current lower-level passes do not cover five newly identified
release blockers, and no gap below should be treated as closed. Prior
0030/0031/0032, legal-queue-ID and billing-debit-replay evidence remains passed
only within its original lower-level scope.
Checkpoint this as an incomplete audit; do not promote it as a completed
hardening iteration.

## Scope and non-guarantee

This is an incremental hardening plan, not a promise that the system will work
unchanged for ten years. Provider APIs, models, prices, media formats and
platform policies will change. Production is **NO-GO** today because live final
outputs and delivery paths are unverified. No paid calls or production mutations
were made for this audit.

## Authoritative references

Release owners must fetch these sources at release time rather than copying old
dates from comments:

- BullMQ stalled jobs:
  <https://docs.bullmq.io/guide/jobs/stalled>
- BullMQ job IDs:
  <https://docs.bullmq.io/guide/jobs/job-ids>
- BullMQ deduplication:
  <https://docs.bullmq.io/guide/jobs/deduplication>
- BullMQ retrying failed jobs:
  <https://docs.bullmq.io/guide/retrying-failing-jobs>
- BullMQ idempotent jobs:
  <https://docs.bullmq.io/patterns/idempotent-jobs>
- Google Veo:
  <https://ai.google.dev/gemini-api/docs/veo>
- Google model deprecations:
  <https://ai.google.dev/gemini-api/docs/deprecations>
- OpenAI Node retries:
  <https://github.com/openai/openai-node#retries>

BullMQ can return stalled jobs to waiting; that is at-least-once recovery, not a
guarantee a paid processor executes once. Custom job IDs and deduplication reduce
duplicates only within their documented lifecycle. Processors still need
durable, tenant-scoped idempotency.

Google’s Veo guidance requires retaining `operation.name`; after restart,
reconstruct `GenerateVideosOperation` and continue polling. Generated videos are
retained by Google for two days, so download and durable storage are mandatory.
The current implementation does not yet meet that requirement: the name remains
in memory until error/accounting rather than being persisted before polling.

OpenAI’s Node SDK defaults to two retries for selected failures. This repository
sets `maxRetries: 0`; retain that while queue/service policy owns retries.

The Gemini deprecations page is the authority for dates. Fetch its current table
before every release. Shutdown dates/model claims in repository comments are
untrusted until confirmed; do not automate a production shutdown or fallback
solely from stale source comments.

## Recommended target: retain and harden BullMQ

BullMQ/Redis is already the executable queue, with centralized worker policy,
deterministic IDs, retries/backoff, circuit breaking, graceful drain, telemetry,
tenant execution and credit settlement. The lowest-risk path is:

1. treat remaining pg-boss names/fields/dependency metadata as historical
   compatibility residue; no runtime migration is required by the current
   architecture decision, and any cleanup is documentation/dependency-scope
   work only;
2. persist generation runs and provider submissions in PostgreSQL as the durable
   state machine;
3. treat BullMQ as delivery/lease infrastructure, not the source of truth;
4. add tenant-scoped deduplication windows and stable run IDs at API admission;
5. make every paid processor idempotent at stage boundaries;
6. persist provider operation/request identities and output checksums;
7. reconcile stalled/ambiguous runs rather than automatically resubmitting;
8. version prompts, schemas, adapters, validators and pricing.

The 11 passing media replay-safety tests recorded in
`test-results/media-audit/reconciliation-replay-safety-final.tap` are useful
simulated fault evidence, not live E2E certification. Current improvements
include deterministic podcast queue identity, reconciliation holds protected
from direct release and stale sweeping, and one retry owner for the tested
OpenAI 429 path. The suite invokes actual wrappers with fake dependencies and
observes one `generateSingleImage` SDK call per timeout/missing-payload case, one
`generateAndStoreHeroImage` SDK plus one storage attempt on storage failure, and
three `callOpenAI` physical calls for 429. The direct DEV DB state suite is
14/14, including direct-release and sweeper protection for a flagged stale hold.

Direct image does not yet demonstrate the target resource-wide pre-entry
pattern. Its preflight and per-run claim are separate; different resource
versions derive different run IDs and can both submit. Nine mocks cover only
same-version concurrency. It also needs durable successful-result replay, and
cap accounting must retain pending usage if completed-event recording fails
rather than swallowing the error and cancelling the reservation.

Podcast must make debit plus billing checkpoint recoverable without deleting a
delivered asset or returning to a provider-retryable failed state. The READY
settlement branch needs the same treatment. Sweeper recovery must use the
actual hashed podcast job ID and must not swallow failed recovery into a state
that permits a new run. Its cap reservation identity must reach worker
completion so pending usage is replaced rather than overlapping completed
usage for two hours.

Batch ambiguous replay needs a compare-and-set update that cannot regress
`RUNNING` or `CANCELLED`; queue inspection followed by an unconditional
`QUEUED` write is not acceptable.

Before promotion, extend equivalent entry leases and resource-run linkage to
social video and standalone audio, add a general durable provider-submission
journal, use stable attempt object identity, persist Veo's operation name before
polling, certify Google SDK retry ownership, and make cancellation semantics
explicit. Podcast's real-Redis accepted-write/lost-ack lookup and direct-image
per-run flag are useful lower-level patterns, not proof of the missing
resource-wide/settlement invariants. A DB
`FAILED` update cannot abort active provider work, and reconciliation metadata
is not a hard kill.

Keep additive schema drift gates in the release process. Migration 0031 restores
ENABLE+FORCE RLS on the five affected provider/campaign tables and aligns the ORM
with `enableRLS()`; migration 0032 adds pending-reconciliation metadata to
reservations. Current 2 RLS-schema, 2 reservation-schema, 6 billing-concurrency,
and ordinary-role cross-tenant ledger evidence is DEV/lower-level only. A deploy
must independently prove migration order, policies, FORCE state, role grants and
cross-tenant denial before traffic.

### Alternatives considered, no migration recommended

| Option | License/topology | Benefit | Cost/risk versus current tree |
|---|---|---|---|
| Hardened BullMQ | existing Node/Redis stack | least migration risk; mature retry/stall/dedup primitives | still at-least-once; requires application idempotency and durable submission state |
| Temporal | MIT SDK/server; additional Temporal service, persistence and workers | durable workflow history, timers and explicit activities | extra server/control-plane expertise and a large rewrite; provider calls still need idempotency |
| Trigger.dev | Apache-2.0; additional Trigger.dev control plane/self-hosted services | developer-friendly durable tasks/observability | extra control plane and vendor/operational surface; migration does not remove paid-call ambiguity |

Do not migrate stacks during this hardening program. First prove invariants on
BullMQ. Reconsider only with measured requirements BullMQ cannot satisfy and a
shadow migration plan.

## Provider replacement architecture

Introduce/complete narrow versioned ports:

```text
TextProvider.generate(contract, context)
ImageProvider.generate(contract, context)
VideoProvider.submit(contract, context) -> durable operation identity
VideoProvider.poll(operation)
AudioProvider.synthesize(contract, context)
Embedding/Classification/ModerationProvider
```

Adapters return a normalized envelope: provider/model/API version, request or
operation ID, usage, finish reason, raw-contract version, checksum and retry
classification. Business services consume normalized schemas, never SDK
responses. Provider-specific options remain inside adapters.

Replacement procedure:

1. fetch current availability/deprecation/pricing/privacy terms;
2. implement an adapter and map normalized errors/usage;
3. replay golden contract fixtures without paid calls;
4. run isolated non-production live canaries with spend ceilings;
5. validate quality, safety, storage, retrieval and accounting;
6. shadow a small tenant cohort and compare checksums/metrics;
7. promote by configuration, retain rollback, and archive evidence;
8. remove the old adapter only after in-flight operations and stored references
   are reconciled.

Availability fallback must not be automatic if modality, output schema, privacy
or price differs. Model replacement is a release, not a string edit.

## Durable generation state machine

Use explicit append-only transitions:

```text
REQUESTED -> RESERVED -> QUEUED -> CLAIMED
-> SUBMITTING -> SUBMITTED(providerOperationId)
-> POLLING -> RESULT_OBTAINED -> VALIDATED
-> STORED -> RETRIEVAL_VERIFIED -> DELIVERED
-> SETTLED
```

Terminal/exception states include `REJECTED`, `FAILED_PRE_SUBMIT`,
`AMBIGUOUS_SUBMISSION`, `FAILED_VALIDATION`, `FAILED_STORAGE`,
`CANCEL_REQUESTED`, `CANCELLED_PRE_SUBMIT`, `DELIVERED_BILLING_PENDING` and
`MANUAL_RECONCILIATION`. Each transition must be compare-and-set by tenant/run
and record actor, attempt, timestamp and reason.

## Rolling upgrade and compatibility

- Version job payloads; workers accept current and one prior version.
- Version stored output schemas/prompts and migrate on read or asynchronously.
- Deploy additive DB changes before code, then readers, writers, backfill and
  only later constraints/removals.
- Drain old workers before removing adapter/model support.
- Use stable object URLs and content-addressed checksums; do not store temporary
  provider URLs as final delivery.
- Keep FFmpeg/codec/browser compatibility fixtures for MP4, MP3 and images.
- Canary every model/provider/SDK update through actual storage and retrieval.
- Separate system health, provider catalogue health, generation canary health
  and user-delivery health.

## Ten-year maintenance cadence

- **Continuous:** provider error/cost/latency breaker, stalled/ambiguous-run
  reconciliation, object and billing sweeps.
- **Weekly:** sample retrieved final assets; inspect provider/model drift and
  queue retry multiplication.
- **Before every release:** fetch deprecation tables, run contract/security/
  privacy tests, verify schema gates and worker-version compatibility.
- **Monthly:** reconcile provider invoices to physical submission ledger and
  credits; exercise restore/queue pause/kill switches.
- **Quarterly:** live capped canaries for each modality and publishing adapter;
  DPA/subprocessor/retention review.
- **Annually:** disaster recovery, storage migration evidence, dependency/codec
  lifecycle and alternative-orchestrator decision review.

The current scan records dependency findings **0**, SAST **0**, privacy **1**,
medium **2**, low **0**. Income, address and budget context sent to GenAI needs a
DPA/data-processing review. No architecture document can substitute for that
approval, recurring live evidence, or ongoing provider-change monitoring.
