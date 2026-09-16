# RC-1 queue contract verifier report

## Final dedicated rerun — previously failing suites only

### Decision

**APPROVE — targeted RC-1 queue contract integration, not live generation.**

After inspecting the changed tests, the verifier reran only the two suites that
failed in the prior dedicated `16379` run. Both used the shared
`127.0.0.1:16379` endpoint, with the sanitized environment and installed
Node/tsx runner. No application endpoint, `REDIS_URL`, worker, provider,
database, workflow, or other test suite was used.

Final rerun counts:

| Rerun suite | Tests | Pass | Fail | Skipped | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `tests/batches/queue-real-id.test.ts` | 1 | 1 | 0 | 0 | exit 0 |
| `tests/podcast-queue-real-add.test.ts` | 1 | 1 | 0 | 0 | exit 0 |
| **Rerun total** | **2** | **2** | **0** | **0** | **PASS** |

Commands:

```text
timeout 60s env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT -u LOCAL_TEST_REDIS_PORT node --import tsx/esm --test --test-concurrency=1 tests/batches/queue-real-id.test.ts
timeout 60s env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT -u LOCAL_TEST_REDIS_PORT node --import tsx/esm --test --test-concurrency=1 tests/podcast-queue-real-add.test.ts
```

The earlier full custom-ID suite (**2/2**) and video suite (**1/1**) remain
passing evidence from the same dedicated Redis run. Combined final targeted
RC-1 Redis evidence is therefore **5 tests: 5 pass, 0 fail, 0 skipped**.
The separately selected unit boundary remains **1 pass, 1 selection-only
skip, 0 fail**; that skip is not acceptance evidence, and the full custom
suite ran its Redis branch without a skip.

The rerun executed the assertions that were previously unreached:

- `queue-real-id.test.ts` now verifies a vendor-supported three-segment colon
  ID can be stored and removed, while the application enqueue boundary
  rejects that same colon-bearing ID with `InvalidQueueCustomIdError`.
- `podcast-queue-real-add.test.ts` verifies the current canonical job and
  credit-scoped legacy job in real Redis, explicitly simulates the unrelated
  generic legacy job through `getJob`, asserts it is not consulted for the
  current credit-scoped lookup/enqueue, preserves both `creditRunId` and cap
  identity, and completes the accepted-write ambiguity recovery after a real
  Redis commit.

This **APPROVE** is limited to the isolated queue-contract integration suites
and does not create or upgrade any live-generation grade, feature status, or
remediation-state status. No codefixes, production writes, dependency
changes, next scope, restart, or Task 179 edits were made.

## Prior dedicated revision — isolated Redis on port 16379 (retained)

### Decision

**FAIL — queue contract integration is not approved (2 targeted suite failures).**

This dedicated revision ran after the previously unavailable service was
provided. The verifier used only the shared test endpoint
`127.0.0.1:16379`; the preflight returned `PONG`. The endpoint was the
ephemeral, persistence-disabled Redis supplied for this run. No application
Redis endpoint (`127.0.0.1:6379`), `REDIS_URL`, external database, provider,
business worker, or application process was used.

The unit boundary passed, and three of the four full Redis-backed suites
passed. The full targeted Redis result was **5 tests: 3 pass, 2 fail**. The
failures are retained as observed test evidence; they are not converted into
an approval or hidden as infrastructure failures.

No codefixes were made. The verifier did not start the application or a
worker, install dependencies, write production data, change a secret URL,
edit Task 179, start a next scope, or modify the remediation state file.

### Pre-execution review and safety boundary

Before this dedicated run, the verifier inspected the changed targeted tests
and the shared endpoint helper:

- `tests/helpers/isolated-redis.ts`
- `tests/batches/queue-custom-id-contract.test.ts`
- `tests/batches/queue-real-id.test.ts`
- `tests/batches/video-queue-real-id.test.ts`
- `tests/podcast-queue-real-add.test.ts`

All four Redis suites import the shared `ISOLATED_TEST_REDIS_PORT` constant
(`16379`) and connect to host `127.0.0.1`. They use unique test queue
prefixes, construct `Queue` objects only, and start no `Worker`. No test can
consume application queues. No provider, external network, real DB, business
job, `FLUSHALL`, or existing-queue cleanup is used; teardown only removes
test-created jobs or isolated test queues.

The verifier removed potentially injected connection variables for every test
process:

```text
env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT -u LOCAL_TEST_REDIS_PORT
```

### Commands and actual results

Dedicated Redis preflight:

```text
env -u REDIS_URL redis-cli -h 127.0.0.1 -p 16379 ping
```

Observed:

```text
PONG
exit 0
```

The targeted unit boundary was selected separately:

```text
env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT -u LOCAL_TEST_REDIS_PORT node --import tsx/esm --test --test-concurrency=1 --test-name-pattern='canonical queue ids and enqueue validation reject unsafe custom ids' tests/batches/queue-custom-id-contract.test.ts
```

Observed:

```text
tests 2
pass 1
fail 0
cancelled 0
skipped 1
todo 0
exit 0
```

The one skipped item was the deliberately name-filtered Redis subtest. It is a
selection artifact only and is **not** acceptance evidence; no skipped
acceptance branch is claimed. The same Redis subtest was executed, without a
filter, in the full `queue-custom-id-contract.test.ts` run below.

Each of the four Redis suites was then run separately with the installed
Node/tsx runner and `--test-concurrency=1`:

```text
timeout 60s env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT -u LOCAL_TEST_REDIS_PORT node --import tsx/esm --test --test-concurrency=1 <one-targeted-suite>
```

Actual per-suite results:

| Targeted suite | Tests | Pass | Fail | Skipped | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `tests/batches/queue-custom-id-contract.test.ts` | 2 | 2 | 0 | 0 | exit 0 |
| `tests/batches/queue-real-id.test.ts` | 1 | 0 | 1 | 0 | exit 1 |
| `tests/batches/video-queue-real-id.test.ts` | 1 | 1 | 0 | 0 | exit 0 |
| `tests/podcast-queue-real-add.test.ts` | 1 | 0 | 1 | 0 | exit 1 |
| **Full four-suite total** | **5** | **3** | **2** | **0** | **FAIL** |

Observed failure details:

1. `queue-real-id.test.ts` enqueued the batch/article/image and daily-brief
   fixtures, then failed at the expected rejection for the raw
   `daily-brief:1:2099-01-02` custom ID (`Missing expected rejection`,
   test line 69). The full suite therefore does not pass its invalid-legacy-ID
   assertion.
2. `podcast-queue-real-add.test.ts` passed the initial canonical candidate and
   enqueue/payload assertions, then the direct attempt to insert the generic
   historical ID `podcast:4242` failed in BullMQ with `Custom Id cannot contain
   :` (the generic legacy insertion around test lines 80–84). The
   unrelated-generic suppression and subsequent ambiguous-recovery assertions
   were therefore not reached in this suite execution. The exact
   credit-scoped legacy candidate insertion is distinct and was not the
   failing operation.

The full custom-ID suite passed both its boundary unit test and its Redis
test, including `addBulk`, publishing/intelligence/social enqueue, duplicate
suppression, exact `creditRunId` preservation, and test-owned removals. The
full video suite passed its four isolated enqueue/read checks, legacy
candidate assertions, and durable `creditRunId` preservation. No cancellation
operation is directly exercised by these four targeted suites.

### Prior contract disposition (retained)

- Collision-safe canonical IDs: **unit and full custom Redis assertions pass**.
- Boundary `Queue.add` and `Queue.addBulk` invalid-ID rejection: **unit and
  custom Redis assertions pass**; the daily-brief raw-Queue legacy rejection
  assertion fails in `queue-real-id.test.ts`.
- All represented job types (batch, article, image, daily brief, publishing,
  intelligence, social, video idea, social video, and podcast): **partial
  runtime evidence only** because two suites fail.
- Legacy lookup/candidate behavior: candidate shape and credit-scoped
  podcast legacy behavior are reached, but the failing generic legacy setup
  prevents approval of the full podcast legacy/recovery scenario.
- Social dedupe: **passes** in the full custom Redis suite.
- Ambiguous accepted-write recovery: **not approved**; the podcast test does
  not reach that assertion after the generic legacy insertion failure.
- Exact removals: **passes where reached** for test-owned custom/video jobs and
  the initial podcast job; no cancellation assertion exists in these suites.
- Billing identities: **passes where reached** for custom bulk/social and
  video payloads; initial podcast `creditRunId` and cap-reservation payload
  assertions pass before the later failure. The unreached podcast
  new-credit/recovery branch is not approved.

The current dedicated run therefore remains **FAIL**, not `APPROVE`, for queue
contract integration. This is a queue-contract result only and is not a live
generation result.

## Prior blocked run (retained history)

### Historical decision

**FAIL — queue contract integration is not approved (runtime blocker).**

This is an independent verifier result for the queue-contract integration
boundary only. It is **not** a live-generation result and does not claim that
any provider, worker, database, publishing, email, or customer-data path
works. The required real local Redis service was unavailable at
`127.0.0.1:6379`, so the Redis-backed contract evidence could not be
collected. The one non-Redis unit test passed, but it is insufficient to
approve this integration gate.

No source or production code was changed by this verifier. The remediation
state file was not changed, no dependency was installed, no worker or
application was started or restarted, and no external URL or injected secret
URL was used. No next scope was started and no Task 179 files or ownership
were touched.

## Pre-execution review and safety boundary

Before execution, this verifier read:

- `reports/qa-remediation/rc1-worker.md`
- `tests/batches/queue-custom-id-contract.test.ts`
- `tests/batches/queue-real-id.test.ts`
- `tests/batches/video-queue-real-id.test.ts`
- `tests/podcast-queue-real-add.test.ts`

The inspected tests use only explicit `127.0.0.1:6379` Redis connections and
unique, time/process-scoped queue names:

- `queue-custom-id-contract-*`
- `batch-id-regression-*`
- `daily-brief-id-regression-*`
- `video-idea-id-contract-*`
- `social-video-id-contract-*`
- `test-podcast-add-*`

They construct `Queue` objects only; no `Worker` is constructed and no
business/provider job is consumed. The payloads are synthetic fixtures
(`example.test`, test IDs, and test billing identities). The suites do not
use application queue names, `REDIS_URL`, a provider, a database driver, a
network request, `FLUSHALL`, or cleanup of an existing application queue.
Teardown is limited to jobs/isolated queues created by the test itself.

The verifier also ran with the potentially injected connection variables
removed:

```text
env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT
```

## Commands and observed counts

### Redis preflight

```text
redis-cli -h 127.0.0.1 -p 6379 ping
```

Observed:

```text
Could not connect to Redis at 127.0.0.1:6379: Connection refused
exit 1
```

No alternate Redis URL was injected and no Redis process was started.

### Non-Redis unit boundary

```text
env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT node --import tsx/esm --test --test-name-pattern='canonical queue ids and enqueue validation reject unsafe custom ids' tests/batches/queue-custom-id-contract.test.ts
```

Observed:

```text
tests 2
pass 1
fail 0
cancelled 0
skipped 1
todo 0
exit 0
```

This passed the deterministic collision-resistance assertions and the
pre-`Queue.add` typed rejection checks for colon-bearing and purely numeric
IDs. The Redis test in the same file was intentionally skipped by the name
pattern in this unit-only run.

### Redis-backed targeted suites

Each file was run separately with the installed Node/tsx runner, one test at a
time, with a 35-second outer safety timeout:

```text
timeout 35s env -u REDIS_URL -u DATABASE_URL -u PGHOST -u PGPORT node --import tsx/esm --test --test-concurrency=1 <targeted-test-file>
```

Actual results:

| Targeted file | Tests | Pass | Fail | Process result | Observed blocker |
| --- | ---: | ---: | ---: | --- | --- |
| `tests/batches/queue-custom-id-contract.test.ts` | 2 | 1 | 1 | exit 1 | `ECONNREFUSED 127.0.0.1:6379`; teardown then reported `Connection is closed` |
| `tests/batches/queue-real-id.test.ts` | 1 | 0 | 1 | exit 1 | `ECONNREFUSED 127.0.0.1:6379` |
| `tests/batches/video-queue-real-id.test.ts` | 1 | 0 | 1 | outer timeout 124 | inner test timed out after 15 seconds while Redis connection attempts remained refused |
| `tests/podcast-queue-real-add.test.ts` | 1 | 0 | 1 | exit 1 | `ECONNREFUSED 127.0.0.1:6379`; teardown then reported `Connection is closed` |

The direct targeted invocation of all four files was also attempted with the
same sanitized environment and installed runner. It was stopped by the
execution timeout after repeated `ECONNREFUSED` output; that aggregate
invocation is not counted as a pass and is not used to hide the per-file
results above.

There were no successful Redis writes, reads, removals, dedupe observations,
or recovery observations in this run.

## Contract coverage disposition

The reviewed source tests are aimed at the required RC-1 boundaries:

- Canonical collision-safe IDs and deterministic hashing: unit boundary passed;
  real Redis persistence was blocked.
- Batch, article, image, daily brief, publishing, intelligence, social,
  video-idea, social-video, and podcast ID paths: represented in the reviewed
  suites, but not runtime-verified because Redis was unavailable.
- `Queue.add` and `Queue.addBulk` invalid-ID rejection: unit `Queue.add`
  rejection passed; real `add`/`addBulk` checks were blocked.
- Legacy lookup/candidate behavior: represented by the reviewed candidate and
  lookup assertions, including podcast legacy IDs and article run lookup; no
  Redis-backed result was observed.
- Duplicate suppression: represented by the social singleton duplicate case;
  not executed against Redis.
- Ambiguous accepted-write recovery: represented by the podcast
  post-commit/synthetic-error case; not executed against Redis.
- Exact removal: represented by test-owned `Job.remove()` teardown and the
  podcast exact-job removal assertions; no successful Redis removal was
  observed.
- Cancellation: none of the four targeted RC-1 files directly exercises a
  queue cancellation operation. Therefore cancellation is not claimed as
  verified by this run.
- Billing identity preservation: exact `creditRunId` assertions are present in
  the bulk, social, podcast, video, and related fixtures; no Redis-backed
  payload read succeeded, so unchanged billing identity is not runtime
  approved.

## Historical boundary and stop condition

This result must remain **FAIL / blocked**, not `VERIFIED_PASS`, until the
specified localhost Redis service is available and the same isolated,
zero-worker targeted suites complete with actual Redis counts. The verifier
did not start Redis, alter connection secrets, run other integration suites,
run live generation, or expand the scope.