# Generation testing

**Final review rejected the patch.** Passing checks below are limited evidence,
not release approval. The audit report lists unfixed batch replay races,
cross-version image concurrency, podcast post-debit cleanup/recovery,
failed-release retry protection, and cap-settlement defects.

Audit date: 2026-09-10. See the dated audit report in `reports/` for the final
run results. This document defines the evidence and repeatable test procedure.

## Evidence levels

1. **Static inspection:** a route, control, or provider adapter exists. Not
   evidence that its output works.
2. **Unit/fault injection:** simulated inputs/providers prove a specific policy.
   A fake SDK returning bytes does not prove real provider compatibility.
3. **Development integration:** real PostgreSQL/Redis with isolated fixtures,
   mocked or blocked paid providers. Proves the tested database/queue behavior.
4. **Browser:** actual frontend interactions. Intercepted responses prove UI
   wiring only, not the intercepted backend's behavior.
5. **Live end-to-end:** a real provider returns an asset, which is validated,
   persisted, retrieved through the authorized application, played/rendered,
   downloaded/exported, and billed once. External publication requires external
   platform confirmation, not just a local success state.

**No level-5 generation test was performed in this audit pass.** No new paid
generation or production data mutation was performed through the test harness.
Do not promote the lower-level tests below into whole-platform certification.

## Cost-leak acceptance matrix

| User concern | Evidence | Remaining gap |
|---|---|---|
| Rapid repeated Generate clicks | Shared synchronous latch tests in both batch UIs; tenant-scoped atomic batch claim integration; browser request-count check reported separately | Not a universal idempotency proof for every synchronous generation endpoint |
| Duplicate image/video/audio jobs | Fake paid boundary counts calls separately for all three kinds; shared worker classifies non-replayable outcomes as terminal; article crash/replay tests use real DB/Redis | No durable provider-entry lease across all media workers; lock-loss/concurrent active workers remain a risk |
| Retry after successful provider call | Fake SDK success followed by storage/accounting failure; no second boundary submission; fatal propagation through media retry/fallback catches | The generic boundary is directly integrated in podcast TTS, not universally; full process death cannot throw a protective error |
| Abandoned background jobs | Article lease recovery, settlement protection, graceful/forced worker drain; Veo error object keeps an operation name when the process survives | Veo operation name is not durably journaled before polling; DB cancellation does not abort accepted provider work; hard-kill orphan recovery remains unverified |

## Repeatable safe regression commands

Use the existing development database and local Redis. Integration tests create
their own fixtures; transient fixtures are deleted, while the provider ledger's
dedicated append-only fixture is intentionally retained. They are not read-only. Never point them at
production. Do not run live canaries or general generation workers as a shortcut.

```sh
npm run check
git diff --check

WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/billing/reservation-schema.test.ts
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/batches/batch-submission.test.ts
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/batches/batch-submission-claim.test.ts
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/media-provider-replay-safety.test.ts
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/billing/generation-rls-schema.test.ts
WORKER_PROCESS=true node --env-file=.env.local --import tsx/esm \
  tests/direct-image-operation.test.ts
WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 \
  node --env-file=.env.local --import tsx/esm tests/batches/queue-real-id.test.ts
WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 \
  node --env-file=.env.local --import tsx/esm tests/podcast-queue-real-add.test.ts
```

For the broader suite, run each file in its own direct process. This avoids the
known Node/tsx test-runner IPC problem and prevents provider mocks leaking
between suites:

```sh
for file in \
  tests/billing/reservation-state-machine.test.ts \
  tests/billing/billing-concurrency.test.ts \
  tests/pipeline/pipeline-worker.test.ts \
  tests/pipeline/budget-stop-cleanup.test.ts \
  tests/pipeline/restart-safety.test.ts \
  tests/pipeline/restart-crash-boundaries.test.ts \
  tests/pipeline/execution-contract.test.ts \
  tests/pipeline/delivery-settlement-contract.test.ts \
  tests/pipeline/provider-circuit-breaker.test.ts \
  tests/pipeline/video-idea-quota-retry.test.ts \
  tests/provider-accounting-boundary.test.ts \
  tests/provider-usage-ledger.test.ts \
  tests/provider-usage-ledger.integration.test.ts
do
  WORKER_PROCESS=true REDIS_URL=redis://127.0.0.1:6379 \
    node --env-file=.env.local --import tsx/esm "$file" || exit 1
done
```

Run schema migrations only through the approved deployment/reconciliation
procedure. The schema test plans an INSERT using `EXPLAIN` **without ANALYZE**:
it verifies the real conflict target without executing a financial write. Its
negative cases use a connection-local temporary table, not customer rows.

## Exact screenshot regression

The batch integration fixture uses 28 requested titles, 10 credits per article,
280 reserved credits, and a 10,000,000-credit balance. Two same-identity reserve
deliveries must create one authoritative reservation and one reserve ledger row.
A simulated queue failure must restore the hold to zero and the available
balance to 10,000,000. A failed release must leave submission non-retryable.
The production batch processor is also tested with 28 persisted article rows
and 28 mocked child enqueues, including retry after partial enqueue failure.
Separate isolated Redis tests exercise actual Queue.add for batch/article/image
IDs and podcast accepted-response-loss lookup; no worker is attached to those
test queues. These prove orchestration and broker acceptance, not paid article
or media generation.

## Final focused evidence

- Batch unit/DB suites: 11 + 6 passing.
- Real isolated batch/article/image and podcast queue suites: 1 + 1 passing.
- Media SDK/storage/accounting faults: 11 passing. Actual production image
  functions use fake SDK/storage; actual OpenAI 429 path submits three times.
- Direct-image orchestration: 9 passing. Same-run concurrent entry makes one provider
  call; pre-entry reconciliation flag survives process loss; storage/DB/debit
  failures retain holds; confirmed rejection can be retried in the tested path.
  Simultaneous cross-version requests are not covered and remain unsafe.
- Reservation state machine: 14 passing, including direct development DB
  verification that flagged holds survive release and the stale sweeper.
- Schema: 2 reservation-arbiter + 2 RLS checks; provider-ledger integration:
  5 passing, including cross-tenant denial for an ordinary isolated actor.
- Full TypeScript and whitespace checks pass. The final main application
  restart serves the login page; this is a startup/render check, not a live
  generated-media acceptance test.

The direct-image post-DB/debit HTTP-response-loss window still needs durable
result replay. Veo operation persistence, all-media entry leases, and effective
queued/active cancellation remain release blockers. See the audit report for
review findings, operational warnings and the full evidence boundaries.

The isolated queue tests always connect to `127.0.0.1`; an optional
`LOCAL_TEST_REDIS_PORT` selects a local port only. Never restore their old
application-URL fallback: a failed invocation exposed a configured Redis
credential in tool logs, and that credential requires provider-side rotation.

## Required live acceptance run before certification

Use an explicitly bounded provider-spend budget and isolated internal workspace.
For each implemented pipeline in `GENERATION_PIPELINES.md`:

- Test normal, empty, excessive, malformed, Unicode, injection-like and
  unsupported inputs; verify failure before spend where appropriate.
- Record stable tenant/run/job/stage/attempt identity and the physical provider
  request count, not just the customer debit count.
- Inject 429, 5xx, timeout, empty response, malformed JSON, wrong MIME, corrupt
  bytes, storage outage and ledger failure at their actual boundaries.
- Interrupt before submission, after provider acceptance, after result receipt,
  after upload, after DB publication, and after debit. Restart the worker and
  observe—not infer—whether it resubmits.
- Validate article structure and factual constraints; decode images; probe and
  play complete audio/video including duration, codecs, resolution, narration,
  sync and captions. Test authorized retrieval, download, regeneration, deletion,
  retention and cross-tenant denial.
- Verify social platform length/media contracts and repurposing fidelity.
  Ads Lab is export-only; test finalized exports and approvals, never claim live
  Google/Meta publication.
- Test actual publishing adapters only in isolated provider test accounts.
  Validate callback signatures, retries, token expiry and platform confirmation.
- Test storage outage, queue outage, worker drain, cancellation and abandoned
  jobs under bounded concurrent load. Record p50/p95/p99, memory, queue age,
  retries, orphan operations and provider COGS.

No live stress, 24-hour soak, cross-region failure, production rollback,
provider-switch canary, OAuth publication or final-media playback certification
was completed in this pass. These are explicit acceptance gaps, not passing tests.