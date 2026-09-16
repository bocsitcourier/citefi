# Isolated local-database integration execution

This receipt records one authorized local QA execution against a disposable
PostgreSQL fixture. It is **not** a live-feature or production-readiness pass.
The harness composed and verified the schema before starting the child test
batch. The application server, application database, provider APIs, paid
calls, and SMTP were not used.

## Command and scope

The inspected files were run together in one owned fixture and one
`node --test` batch:

```sh
QA/support/with-isolated-database.sh -- \
  tests/billing/billing-concurrency.test.ts \
  tests/billing/reservation-schema.test.ts \
  tests/billing/reservation-state-machine.test.ts \
  tests/billing/topup-purchases.test.ts \
  tests/billing/generation-rls-schema.test.ts \
  tests/agency-report-config-upsert.integration.test.ts \
  tests/agency-reports.integration.test.ts \
  tests/admin/email-unit.test.ts \
  tests/admin/email-review-link.test.ts
```

The harness supplied `--test-concurrency=1`, while the billing and agency
tests' intentional in-file `Promise.all` calls remained enabled. The
`QA/support/offline-guard.mjs` preload permitted only `127.0.0.1:55481` and
blocked external sockets and fetches.

Before execution, the files were inspected for provider, email, publishing,
HTTP, and process-launch behavior:

* billing suites use only the fixture database; their Stripe references are
  accounting test names/data, not Stripe calls;
* agency reports insert only deterministic `test-provider`/publishing fixture
  rows and use fake delivery functions; no provider or publisher is invoked;
* admin email suites call handlers in-process and use `t.mock.method` email
  stubs where delivery is asserted. SMTP credentials were absent, and no
  real message was sent;
* `tests/admin/admin-notifications.test.ts` was not included because it
  requires a separately running HTTP server on `localhost:5000` and has no
  email stub. Starting that server or widening the offline guard would violate
  this fixture's safety boundary.

## Schema and execution receipt

The harness emitted this schema-only readiness line before child tests:

```text
PASS: isolated schema catalog verified (database=citefi_qa host=127.0.0.1 port=55481; no app DB touched)
```

It applied the generated source schema, canonical early security/bootstrap
scripts, and the tracked versioned migration runner. The migration ledger,
RLS controls, tenant role/grants, required tables, and three
`provider_attempt_receipts` policies passed the catalog gate.

The complete child output is retained at
[`database-execution.log`](database-execution.log). An earlier timed-out
attempt (before the harness added Node's force-exit cleanup behavior) is
retained at [`database-execution-timeout.log`](database-execution-timeout.log).
The final command exited `1` because the batch contained failing assertions;
this is not reported as a feature pass.

Final Node test-runner counts:

```text
# tests 65
# suites 14
# pass 48
# fail 17
# cancelled 0
# skipped 0
# todo 0
HARNESS_EXIT=1
```

The reservation state-machine file's own receipt was `15 passed, 0 failed`.
The billing, generation-RLS, reservation-schema, and agency-config-upsert
cases that completed successfully are included in the aggregate counts above.

## Failure accounting

The first failure causes were retained as test failures; no source feature,
policy, migration, or checksum was changed:

1. The admin email/review-link cases that need admin-panel authorization
   received `403 ADMIN_MFA_ENROLLMENT_REQUIRED` because their seeded admin
   fixture does not satisfy the current administrator-MFA enrollment policy.
   The harness did not disable or weaken that policy.
2. In `agency-reports.integration.test.ts`, the database correctly rejected
   the snapshot update, but the Drizzle query wrapper exposed only
   `Failed query: update ...` while the test asserted the trigger message
   `/snapshots are immutable/`. This is an application/test assertion mismatch,
   not a missing fixture table or column.

No failures were skipped, cancelled, reclassified as passes, or retried.

## Cleanup evidence

The harness's own `EXIT` trap stopped and removed only its fixture. The
post-run cleanup artifact is
[`database-execution-cleanup.log`](database-execution-cleanup.log); it records:

```text
fixture_root=/tmp/citefi-isolated-qa.WKTe86 state=removed
127.0.0.1:55481=no response
active fixture connections=0 (owned postmaster stopped; TCP probe did not connect)
```

No persistent fixture database, credentials, customer data, provider
credential, SMTP credential, or external-network connection was created.