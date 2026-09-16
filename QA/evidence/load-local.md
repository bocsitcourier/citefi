# Safe-local measured load and failure-injection audit

**Run status: PASS (2/2 tests, 0 failures)**  
**Command:** `env -u DATABASE_URL -u NEON_DATABASE_URL -u REDIS_URL QA/support/load-local.sh`  
**Mode:** safe-local only; no application/customer PostgreSQL, provider SDK,
email, publishing, or external network.  
**Execution log:** `QA/evidence/load-local.txt`  
**Historical red proof:** `QA/evidence/load-failure-injection.red.txt`

## Scope and fixture boundary

| Path | Production code exercised | Fixture |
|---|---|---|
| Receipt/CAS load | `runWithProviderAttempt`, receipt prepare/submit CAS, response capture, immutable-ledger reconciliation, spool convergence | In-memory primary receipt store/ledger map plus the production object-spool adapter backed by a temporary local filesystem |
| Queue load | `createPipelineWorker` → `createPipelineHandler`, BullMQ delivery, retry/error classification, lease-conflict billing guard | Redis 7.2.4 process spawned and stopped by the test on `127.0.0.1:16386/15` |
| PostgreSQL | Not exercised by this load run | `PG 55486` was intentionally not started; all DB fields below are explicitly **not DB measurements** |

The receipt provider is an in-process counting stub. `providerPhysicalCalls`
counts calls that crossed the production `submit` boundary, while
`ledgerCount` counts the test's source-event-unique immutable-ledger projection.
No provider request left the process. The queue scenario uses no provider or
ledger and therefore reports those fields as not applicable.

## Receipt/CAS measurements

Each row is one bounded `Promise.all` fanout. `same_identity` intentionally
submits the same deterministic receipt identity from every logical request;
the expected `N-1` errors are explicit `PROVIDER_ATTEMPT_ALREADY_SUBMITTED`
CAS refusals, not load failures. `unique_identity` uses one deterministic
identity per request.

| Workload | Concurrent | Duration ms | p50 ms | p95 ms | Throughput req/s | Errors (expected/unexpected) | Provider physical | Ledger | Receipts/accounted | RSS delta | Heap delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same identity | 1 | 6.886 | 6.827 | 6.827 | 145.23 | 0/0 | 1 | 1 | 1/1 | +131,072 | +183,624 |
| unique identity | 1 | 0.278 | 0.269 | 0.269 | 3,594.76 | 0/0 | 1 | 1 | 1/1 | 0 | +43,288 |
| same identity | 10 | 2.532 | 1.147 | 2.526 | 3,949.55 | 9/0 | 1 | 1 | 1/1 | 0 | +266,160 |
| unique identity | 10 | 2.345 | 2.074 | 2.317 | 4,264.86 | 0/0 | 10 | 10 | 10/10 | +131,072 | +731,992 |
| same identity | 100 | 7.626 | 6.010 | 6.585 | 13,113.63 | 99/0 | 1 | 1 | 1/1 | +524,288 | +2,294,752 |
| unique identity | 100 | 9.543 | 8.905 | 9.403 | 10,479.23 | 0/0 | 100 | 100 | 100/100 | +786,432 | +3,919,648 |

The CAS invariant held at every size: duplicate logical requests never
created a second provider submission, receipt row, or ledger event. Every
physical submission reached `accounted` and had a converged spool object.

## Queue/pipeline measurements

These rows use a fresh owned Redis queue per scenario and concurrency. Success
is the ordinary production handler return path. `lease_expiry` injects the
real `ArticleRunLeaseConflictError` control-flow boundary; the handler must
fail the delivery and must not release its billing reservation.

| Scenario | Concurrent | Duration ms | p50 ms | p95 ms | Throughput req/s | Completed | Failed | Processor calls | Reservation releases | RSS delta | Heap delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| success | 1 | 33.680 | 4.509 | 4.509 | 29.69 | 1 | 0 | 1 | 0 | +131,072 | +1,549,304 |
| lease expiry | 1 | 17.006 | 1.603 | 1.603 | 58.80 | 0 | 1 | 1 | 0 | +131,072 | +1,514,176 |
| success | 10 | 18.214 | 5.455 | 10.509 | 549.03 | 10 | 0 | 10 | 0 | -4,599,808 | +2,043,584 |
| lease expiry | 10 | 28.331 | 7.476 | 12.634 | 352.97 | 0 | 10 | 10 | 0 | +1,966,080 | +1,832,704 |
| success | 100 | 83.537 | 42.485 | 67.470 | 1,197.08 | 100 | 0 | 100 | 0 | +5,242,880 | +1,840,248 |
| lease expiry | 100 | 124.171 | 58.277 | 103.158 | 805.34 | 0 | 100 | 100 | 0 | +2,359,296 | -1,803,720 |

All 100 lease-expiry deliveries were classified and failed without a
reservation release. This is a bounded lease-owner conflict injection, not a
claim that a PostgreSQL lease clock was measured.

## Fault-injection results

All scenarios exercised real production receipt state transitions rather than
AST copies or test-only reimplementations:

1. **Pre-admission storage fault:** `spool.ensureReady()` failed before
   submission; the provider physical count stayed zero.
2. **Post-provider ledger fault / crash boundary:** the provider returned once,
   the first immutable-ledger write failed, and the faulted status was persisted
   to the local durable spool. A recreated spool adapter reconciled the event
   to one ledger row and `accounted` receipt without replaying the provider.
3. **Primary response-storage fault:** the primary receipt capture write failed
   after the provider response. The production fallback spool carried the
   response evidence; reconciliation converged the primary, spool, and ledger
   with one provider call.

The first actual run exposed a bounded defect in the third-party-independent
spool contract: a human-readable failure message could not pass the strict
failure taxonomy validator during post-provider status fallback. The fix in
`lib/provider-attempt-receipts.ts` retains the human-readable message in the
primary store but writes the fixed failure code to the strict spool record.
The retained red proof documents the failure; the rerun is green.

## Hardware and local-environment limits

Observed runner: Linux x86_64 (`Linux 6.18.52`), 8 CPUs, 15 GiB total /
8.5 GiB available at inspection, Node `v20.20.0`, Redis `7.2.4`,
PostgreSQL `16.10` installed but not used. Memory values are process
`rss`/`heapUsed` deltas around each bounded case; they are not capacity
limits. Redis and filesystem timings include this shared runner's scheduler,
filesystem, and neighboring workload effects.

No unbounded stress, saturation search, extrapolation, or production capacity
claim is made. The 100-request cases are the maximum intentionally exercised
fanout.

## Measurements versus forecasts

**Measured above:** exact local durations, p50/p95, bounded throughput,
logical error counts, duplicate-CAS behavior, provider-stub physical counts,
source-event ledger counts, receipt counts, queue terminal counts, reservation
release counts, and process memory deltas.

**Not measured / forecast only:** application PostgreSQL lock contention,
RLS overhead, production pool sizing, production Redis latency, cross-process
worker capacity, object-storage network latency, provider latency/rate limits,
provider billing, customer-data volume, and any sustainable 10x/100x
production capacity. Those require separately authorized isolated fixtures and
must not be inferred from these memory/owned-local-Redis numbers.