# Operations / agency / billing QA execution

## Scope and safety boundary

This is the first execution pass after Phase 1 discovery for the delegated
scope: agency reports, billing, email, publishing, storage, migration,
journey/learning/ZIP inventory, and operational/configuration checks. The
independent verifier did not implement a fix and did not grade a feature as
live-verified.

The Node tests were launched with `QA/support/offline-guard.mjs` preloaded.
The guard denies external sockets and `fetch`; no application port `5000`,
application Redis `6379`, provider, SMTP, publishing receiver, or customer
database was contacted. Database-dependent tests that require a database were
given a temporary, non-application localhost target (the value is omitted
here) and were expected to stop at the guard. No `.env` file was loaded and no
secret or environment value is recorded. The one authorized database
procedure, `tests/provider-attempt-migration.test.sh`, created its own
temporary PostgreSQL cluster on Unix socket / port `55479`, then tore it down.
No workflow or application process was restarted.

The existing setup was inspected before selecting runners:

* Pure and source-contract TypeScript tests used Node 20's direct
  `node --import tsx/esm --test` runner with the offline guard.
* The email suites were run as direct processes (their comments document the
  Node 20 mutable-service strategy rather than `mock.module()`).
* Database suites were run only with the offline guard and a fake local
  target. Their failures below are **BLOCKED guard**, not application defects.
* `provider-attempt-migration.test.sh` was read in full and run exactly once.
* No broad `tsc`, test glob, workflow, live provider, external email,
  external publishing, app-DB fixture, network probe, or load run was used.

## Command ledger

The command form below omits the temporary database override. Every Node
command that could import database code had the guard preloaded; no command
used `--env-file`.

| Command / scope | Exit | Result counts / sanitized output |
|---|---:|---|
| `node --import tsx/esm --test tests/agency-report-concurrency.test.ts` | 0 | 3 tests, 3 pass, 0 fail |
| `node --import tsx/esm --test tests/agency-report-routes.test.ts` | 0 | 7 tests, 7 pass, 0 fail |
| `node --import tsx/esm --test tests/agency-report-service.test.ts` | 0 | 8 tests, 8 pass, 0 fail |
| `node --import tsx/esm tests/agency-report-config-upsert.integration.test.ts` | 1 | 1 test blocked in `before` by `QA_OFFLINE_NETWORK_BLOCKED`; 0 app assertions executed |
| `node --import tsx/esm tests/agency-reports.integration.test.ts` | 1 | 1 test blocked in `before` by `QA_OFFLINE_NETWORK_BLOCKED`; cleanup also reported guard-induced socket closure |
| `node --import tsx/esm --test tests/storage-migration.test.ts` | 0 | 5 tests, 5 pass; memory stores only |
| `node --import tsx/esm --test tests/billing/stripe-credit-reconciliation.test.ts` | 0 | 2 tests, 2 pass |
| `node --import tsx/esm --test tests/billing/generation-rls-schema.test.ts` | 1 | 2 tests: 1 source/schema pass, 1 live catalog test blocked by `QA_OFFLINE_NETWORK_BLOCKED` |
| `node --import tsx/esm tests/billing/billing-concurrency.test.ts` | 1 | 6 tests blocked at database seed queries; the driver wrapped the guard error as `Failed query`; 0 app assertions executed |
| `node --import tsx/esm tests/billing/reservation-schema.test.ts` | 1 | 2 tests blocked by `QA_OFFLINE_NETWORK_BLOCKED` before database connection |
| `node --import tsx/esm tests/billing/reservation-state-machine.test.ts` | 13 | 11 manual-runner checks emitted guard-blocked seed-query failures; no database state-machine result |
| `node --import tsx/esm tests/billing/topup-purchases.test.ts` | 1 | 3 tests: fixed-pack assertion passed; 2 database-dependent checks blocked after guarded setup failure |
| `node --import tsx/esm tests/admin/email-unit.test.ts` | 1 | 5 tests cancelled by guarded database setup; no SMTP call; cleanup warning was guard-induced |
| `node --import tsx/esm tests/admin/email-review-link.test.ts` | 1 | 37 tests cancelled by guarded database setup; no SMTP call; cleanup warning was guard-induced |
| `bash tests/provider-attempt-migration.test.sh` | 0 | PASS: repeatable migration, grants/RLS tenant isolation, client-viewer restriction |
| `node --test tests/migration-start-version-regression.test.mjs` | 1 | 1 intentionally failing regression: duplicate-`0034` migration selection defect reproduced |
| `node --import tsx/esm --test tests/ops/health.test.ts` | 0 | 14 tests, 14 pass; injected dependencies only |
| `node --import tsx/esm --test tests/production-readiness-drills.test.ts` | 0 | 4 tests, 4 pass; injected local evidence only |
| `node --import tsx/esm --test tests/process-diagnostics.test.ts` | 0 | 5 tests, 5 pass; temporary local spool only |
| `node --import tsx/esm --test tests/profitability-read-contract.test.ts` | 0 | 2 source-contract tests, 2 pass |
| `bash tests/deployment/deploy-contract.test.sh` | 1 | Static contract failed: expected `MIGRATION_START_VERSION=0022` was not present in current `scripts/post-merge.sh` |

Three exploratory narrowed reruns were also performed while confirming setup:
the agency route pattern rerun was 2 pass / 5 skipped, the RLS source-only
pattern rerun was 1 pass / 1 skipped, and the top-up fixed-pack pattern rerun
was 1 pass / 2 skipped. They are not counted again in the totals above.

## Per-test result detail

### Agency reports

**PASS (18 source/deterministic checks):**

* `agency-report-concurrency.test.ts`: `controlled concurrency double: eight
  serializable requests converge on one report and snapshot`; `controlled
  transaction double retries the entire callback for 40001 and 40P01`;
  `controlled transaction double propagates non-retryable errors and honors
  bounded attempts`.
* `agency-report-routes.test.ts`: `all agency report routes use callback-scoped
  agency admin authentication`; `client routes require reviewer auth and never
  reference agency-only projections`; `client HTML renderer escapes content and
  strips private snapshot keys`; `rebilling CSV is deterministic and
  unavailable for draft configuration snapshots`; `download contracts set safe
  attachment headers and client reads are approved-only`; `generation surfaces
  a missing period-unique schema prerequisite explicitly`; `send contract
  serializes recipient sends and records redacted success or failure history`.
* `agency-report-service.test.ts`: `client snapshot sanitizer recursively
  excludes private accounting and generation data`; `report hashes are
  deterministic across object insertion order`; `agency report advisory lock key
  is versioned, canonical, and period-ordered`; `approved markup reconciliation
  uses integer microUSD and draft revenue is unavailable`; `direct-child
  isolation and client approved-only boundary are database enforced`;
  `client-facing service selects only safe report columns and missing metrics
  remain explicit`; `report config upsert locks the agency row and performs a
  legacy-schema-safe update-or-insert`; `agency report generation requires the
  exact period uniqueness prerequisite`.

**BLOCKED guard (2 integration checks):**

* `agency-report-config-upsert.integration.test.ts` — locked config upsert.
* `agency-reports.integration.test.ts` — accounting, immutability, RLS, and
  delivery idempotency.

The tenant report snapshot was therefore covered by isolated deterministic
sanitizer/source checks, while the database snapshot/RLS portion is explicitly
blocked. No live tenant report was claimed.

### Billing

**PASS (4 checks):**

* `generation-rls-schema.test.ts`: `generation security controls survive
  declarative schema pushes`.
* `stripe-credit-reconciliation.test.ts`: `cumulative Stripe partial refunds
  reverse an exact partitioned credit total`; `created and won Stripe disputes
  never revoke credits; only lost does`.
* `topup-purchases.test.ts`: `offers the requested fixed packs`.

**BLOCKED guard (22 checks):**

* `generation-rls-schema.test.ts`: `all existing public policy tables enforce
  RLS and all five repaired tables retain policies`.
* `billing-concurrency.test.ts`: `concurrent same-run reserve creates one owned
  hold and one ledger projection`; `5 concurrent debits correctly exhaust
  allowance first, then purchased`; `2 concurrent debits with mixed
  allowance+purchased split are correctly attributed`; `duplicate debit with
  same jobId is idempotent`; `concurrent full-debit redelivery with explicit
  amounts settles once`; `partial-debit replay succeeds even when remaining
  hold is smaller`.
* `reservation-schema.test.ts`: `live reservation arbiter supports the exact
  billing INSERT without writing rows`; `schema gate rejects missing/partial
  arbiters and accepts a full tenant/run unique`.
* `reservation-state-machine.test.ts`: `reserve() sets
  reservation_status=RESERVED on the ledger row`; `debit() flips status to
  DEBITED for a full debit`; `release() flips status to RELEASED`;
  `reconciliation hold survives direct release and stale sweeper`; `podcast
  cap reservation completes in place exactly once`; `release() after debit
  (DEBITED) is a no-op — reservation already charged`; `debit() after release
  (RELEASED) returns ok:false — reservation freed before success`; `concurrent
  release+debit (sequential simulation) — exactly one wins`; `successful retry
  debits exactly once (idempotent full debit)`; `final-attempt release then
  retry debit — reservation stays RELEASED`; `release() is idempotent — double
  release does not double-refund`.
* `topup-purchases.test.ts`: `credits a checkout session once and unblocks an
  expired trial`; `partial Stripe reversal is bucket-native and
  retry-idempotent`.

The wrapped `Failed query` messages in billing suites are guard-blocked local
database attempts, not confirmed billing defects. No rows were inserted or
deleted.

### Email

**BLOCKED guard (42 checks):**

* `email-unit.test.ts`: `sendAccountApprovedEmail is called once with the
  approved user's email`; `sendAccountApprovedEmail is NOT called when user is
  already active (409 guard)`; `sendAccountRejectedEmail is called once with
  the rejected user's email when sendEmail defaults to true`;
  `sendAccountRejectedEmail is NOT called when sendEmail=false`;
  `sendAccountRejectedEmail is NOT called for a non-pending (active) user —
  400 guard`.
* `email-review-link.test.ts`: `missing token returns 400 HTML with 'Missing
  token'`; `tampered token returns 400 HTML with 'Invalid'`; `expired token
  returns 410 HTML with 'Approval Link Expired'`; `expired token page surfaces
  the user's email`; `valid token for pending user returns 200 confirmation
  page`; `valid token for already-active user returns 200 graceful 'Already
  actioned' page`; `token for non-existent user returns 400 HTML 'Account not
  found'`; `missing token returns 400 HTML`; `tampered token returns 400 HTML
  'Invalid'`; `expired token returns 410 HTML 'expired'`; `valid approve token
  sets accountStatus=active and returns 200 HTML`; `sendAccountApprovedEmail is
  triggered on successful approval`; `replay attack: reusing an approve token
  returns 400 HTML 'already used'`; `already-active account returns graceful
  200 'Already actioned' (race-condition guard)`; `approve token accepts JSON
  content-type body`; `valid reject token sets accountStatus=suspended and
  returns 200 HTML`; `sendAccountRejectedEmail is triggered on successful
  rejection`; `replay attack: reusing a reject token returns 400 HTML 'already
  used'`; `expired reject token returns 410 HTML 'expired'`; `token signed with
  previous key verifies after rotation (verifyApprovalToken)`; `token signed
  with current key verifies after rotation (verifyApprovalToken)`; `token
  signed with previous key shows confirmation page via GET`; `token signed with
  previous key can be actioned via POST`; `token signed with fully retired key
  (not in keyring) returns 400 Invalid`; `after email-link approves, admin
  panel approve route returns 409 (no double-write)`; `after email-link
  rejects, admin panel reject route returns 409 (no double-write)`; `after
  admin panel approves, email-link POST returns graceful 'Already actioned'`;
  `after admin panel rejects, email-link POST returns graceful 'Already
  actioned'`; `returns 404 for unknown user`; `returns 400 for invalid
  (non-numeric) user ID`; `returns 403 for unauthenticated request`; `returns
  409 when target user is already active (not pending)`; `returns 200 and
  creates a revocation row for a pending user`; `revoked token returns 400
  'revoked' page (GET)`; `revoked token returns 400 'revoked' page (POST) and
  does not mutate accountStatus`; `token issued AFTER revocation is NOT
  blocked`; `expired used_approval_tokens rows are pruned when a POST is
  processed`.

The suites stopped at database seeding under the guard. Email service methods
were not allowed to reach SMTP, so no email behavior is certified.

### Storage, migration, publishing, journey, learning, and ZIP

**PASS (5 isolated storage checks):**

* URL normalization; inventory missing owners/orphans without deletion; SHA-256
  copy certification including image/video-range/podcast reads; unreadable
  primary failure; and cutover disabled for missing/mismatched primary
  configuration. These use in-memory stores and are static/mocked evidence,
  not storage-provider certification.

**PASS (one authorized isolated migration script):**

* `provider-attempt-migration.test.sh` applied
  `0034_provider_attempt_receipts.sql` twice to the temporary cluster,
  verified grants, tenant and campaign ownership behavior, forced RLS, and
  client-viewer exclusion. The post-run process/socket check found no
  PostgreSQL process on `55479` and no leftover fixture socket.

No existing tests matching publishing, journey, learning, or ZIP names were
present in `tests/`. Publishing route/adapters and the email/publishing retry
paths were source-inspected only; no stub-adapter retry/failure suite exists in
this checkout. No external adapter or receiver call was made. No journey,
learning, or ZIP feature is `VERIFIED`; these surfaces remain untested or
blocked, not passed.

### Operational and configuration static checks

**PASS (25 deterministic checks):**

* `ops/health.test.ts` (14): `reports all injected controls healthy`;
  `reports threshold warnings as degraded without failing readiness`;
  `never-run canary fails readiness while an active deployment alone only
  degrades`; `reports stale heartbeat, open circuit, and queue threshold as
  failure`; `bounds, redacts, and fails timed out checks deterministically`;
  `fails closed for missing required storage, models, backup, and worker
  registration`; `fails readiness when required restore verification evidence
  is missing`; `fails readiness when restore verification evidence is stale`;
  `fails readiness when recent restore verification evidence records failure`;
  `accepts fresh successful restore verification separately from backup
  success`; `disabled media is explicit and does not require storage`;
  `occupied port fails deterministically without terminating its owner`;
  `canary accounting remains fail-closed in production and certification`;
  `development can keep workers alive only for an explicitly disabled canary`.
* `production-readiness-drills.test.ts` (4): `evidence redaction removes
  secret keys, URL credentials, assignments, and bearer tokens`; `orchestrator
  emits schema-valid evidence and certification fails on a local failure`;
  `blocked credential-dependent drills fail certification but not explicit
  local-only mode`; `local-only still fails when a local drill is blocked`.
* `process-diagnostics.test.ts` (5): `process diagnostics redact errors, signed
  URLs, cookies, PII, and credentials`; `child output redaction handles
  chunk-split secrets and bounds long lines`; `structured process diagnostics
  recursively sanitize spool records`; `owner-only process spool receives only
  sanitized bounded records`; `termination policy suppresses planned reloads
  and clean exits only`.
* `profitability-read-contract.test.ts` (2): `platform profitability read uses
  immutable ledger and reconciliation records`; `agency profitability read is
  team-admin guarded and excludes unconfigured margin`.

**FAIL (one existing static deployment contract):**

* `tests/deployment/deploy-contract.test.sh` exits at the assertion requiring
  `MIGRATION_START_VERSION=0022` in `scripts/post-merge.sh`. Current source
  sets `MIGRATION_START_VERSION=0020` and documents that `0020` is needed for
  incident-intelligence objects. This is a current test/source contract
  mismatch; it is not classified as a production runtime defect without an
  owner decision about the intended start boundary. No fix was made.

The production pool configuration was checked source-only, with no
environment values read or changed. `lib/db.ts` currently sets
`DB_CONCURRENCY=15`, uses a web pool of 10, worker pool of 20, system pool of
5, and transaction pool of 5. Its comment says the semaphore must stay below a
20-connection pool, which is not true for the web/system/transaction pools.
This is a source-level configuration inconsistency and scale risk, not a
runtime failure measured by this pass. `server/production.ts` and PM2
configuration also explicitly load `.env.local`; no such loading was performed
by this audit and no values were exposed.

## Confirmed defect, regression, and disposition

### Confirmed current defect: duplicate numeric migration version can be skipped

`scripts/run-versioned-migrations.ts:50-56` selects migrations with a
lexicographic comparison of complete filenames:

* `0034_agency_report_period_unique.sql`
* `0034_provider_attempt_receipts.sql`

With `MIGRATION_START_VERSION=0034_provider_attempt_receipts.sql`, the current
selection returns only the provider receipt file and skips the earlier agency
period-unique file. This was reproduced without a database by the new
`tests/migration-start-version-regression.test.mjs`; its expected failure is
recorded above. This is a concrete current-source defect that can leave a
partial schema when a release resumes from the later duplicate filename. No
implementation fix has been made.

### Regression status

The new regression is deliberately failing (`1 test, 0 pass, 1 fail`) so a
future fixer can make the migration selection version-family aware and then
rerun it. The test was not weakened, skipped, or converted to a pass.

## Missing live gates / unsafe-blocked work

* Agency report database snapshot, RLS, accounting, and delivery idempotency
  require a dedicated isolated local PostgreSQL fixture or an explicitly
  approved database target.
* Billing catalog RLS, reservation state transitions, concurrent reservations,
  top-up idempotency, and reconciliation need an isolated local database.
* Email route setup needs isolated database fixtures plus stubbed
  `emailService`; SMTP delivery remains intentionally untested.
* Publishing callback and adapter retry/failure behavior needs isolated
  database fixtures and stub adapters; receiver/network calls remain
  unauthorized.
* Journey and learning orchestration need isolated fixtures and compile/runtime
  harnesses; no feature pass may be inferred from source inspection.
* ZIP export needs an isolated byte/hash fixture and a route-level export
  harness; campaign-domain tests were not run because they are outside this
  delegated scope.
* Production pool sizing, `.env.local` boot behavior, deployment migration
  boundary, Redis/BullMQ behavior, restart/reload behavior, customer-data
  access, and external health gates remain source-only or blocked.
* No 10x/100x load, queue storm, provider accounting, SMTP, publishing
  receiver, backup/restore, or production cutover gate was run.

## 10x / 100x forecasts (not measurements)

These are risk forecasts from source and test topology, not performance claims:

* At 10x concurrent agency-report or billing requests, transaction/advisory
  lock contention and the web pool/semaphore mismatch are likely to increase
  wait time; no latency or correctness forecast is certified.
* At 100x receipt/report or billing fanout, per-row/index writes, RLS checks,
  reconciliation backlog, and spool growth may dominate; capacity and
  retention limits were not load-tested.
* At 10x publishing callback failures or email approval events, retry
  idempotency and delivery serialization need stub-adapter evidence; no
  external receiver/SMTP behavior is inferred.
* At 100x storage migration inventory/copy volume, list/read concurrency,
  range-read verification, object parity, and evidence-file growth need a
  dedicated local fixture and capacity run.
* At 10x/100x journey and learning schedules, tenant-scoped queue fanout and
  corpus/snapshot writes need isolated fixture load tests; no customer data
  was used.

## Group counts and final coverage

Canonical execution totals (narrowed exploratory reruns excluded):

| Group | Pass | Confirmed fail | BLOCKED guard / unsafe | Static-only or absent |
|---|---:|---:|---:|---:|
| Agency | 18 | 0 | 2 | 0 |
| Billing | 4 | 0 | 22 | 0 |
| Email | 0 | 0 | 42 | 0 |
| Storage | 5 | 0 | 0 | provider live gate absent |
| Migration | 1 script | 1 regression | 0 | duplicate-version defect source-confirmed |
| Publishing | 0 | 0 | 0 | no matching tests; source-only |
| Journey / learning / ZIP | 0 | 0 | 0 | no matching tests; source-only/absent |
| Operations/config | 25 | 1 existing contract | 0 | pool/env source-only |
| **Total test/check records** | **53** | **2** | **66** | **unrun live gates** |

The two confirmed failing records are intentionally different: the new
migration regression is a reproduced current defect, while the deployment
contract failure is a test/source expectation mismatch pending owner decision.
No feature is `VERIFIED_PASS`; all passing checks are isolated, deterministic,
or source-contract evidence only.