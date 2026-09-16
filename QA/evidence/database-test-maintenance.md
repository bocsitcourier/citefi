# Isolated database test maintenance

This receipt records the maintenance of the three test files that failed in the
prior isolated database batch. It is a test-harness/fixture pass only. No
production policy, route, migration, or provider implementation was changed.

## Authorized execution

The affected files were run together in one disposable fixture:

```sh
QA/support/with-isolated-database.sh -- \
  tests/admin/email-unit.test.ts \
  tests/admin/email-review-link.test.ts \
  tests/agency-reports.integration.test.ts
```

The harness used its existing `127.0.0.1:55481` fixture, `--test-concurrency=1`,
the offline guard, and its existing post-run pool/cluster cleanup. The final
child TAP is retained at
[`database-test-maintenance.log`](database-test-maintenance.log).

## Exact final counts

```text
# tests 51
# suites 12
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
HARNESS_EXIT=0
```

No test was skipped, cancelled, retried, or converted to a non-asserting
fallback. The harness reported cleanup of the owned PostgreSQL cluster with
zero active fixture connections.

## Fixture maintenance

Both admin email fixtures now represent the shared MFA contract used by
`requireAdmin()`:

* the admin has `two_factor_enabled=1` and `two_factor_method='totp'`;
* a fixture `totp_secrets` enrollment row exists; and
* the persisted admin session has `auth_assurance='mfa'` and a current
  `mfa_verified_at`.

No OTP was generated or verified. The unit suite also has a separate active,
unenrolled admin session and asserts the production enrollment gate returns
HTTP 403 before an email stub can be called. The existing approval/rejection
mail stubs, review-link receipts, replay checks, race guards, and tenancy
assertions remain active.

The agency immutability helper now follows the Drizzle error cause to the
native PostgreSQL error and requires SQLSTATE `P0001` plus the exact immutable
or append-only trigger message. Every rejected update/delete also reads the
row before and after and requires deep-equivalent row data. Financial snapshot
and delivery trigger attempts use the explicit privileged test database
handle because the tenant role is intentionally granted only its production
insert/read permissions; the unrelated-team/client-viewer tenancy checks
remain tenant-scoped.

## Historical red evidence

The pre-maintenance failure evidence was not overwritten:

* [`database-execution.md`](database-execution.md) records the original
  65-test / 48-pass / 17-fail batch.
* [`database-execution.log`](database-execution.log) and
  [`database-execution-timeout.log`](database-execution-timeout.log) retain
  the original red and timed-out attempts.
* [`database-execution-cleanup.log`](database-execution-cleanup.log) retains
  the original fixture cleanup receipt.

The final maintenance result is the separate log linked above; the application
database, external network, SMTP, provider APIs, and real email delivery were
not used.