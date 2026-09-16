# Extended isolated database execution

This receipt records the final serial execution of previously unrun,
database-safe authentication, security, billing, reservation, cancellation,
and budget cases. It is an isolated QA result, not a production or
provider-readiness claim.

## Safety boundary

The final accepted batch used the existing
`QA/support/with-isolated-database.sh` fixture:

* PostgreSQL was owned by the harness and bound only to
  `127.0.0.1:55481`.
* The opt-in Redis fixture was owned by the same harness and bound only to
  `127.0.0.1:16389`. It was required by the budget/video cleanup path and was
  stopped during cleanup.
* Caller database credentials, `.env` values, provider credentials, email
  credentials, proxies, and publishing credentials were removed.
* The schema/catalog gate ran before tests and reported:
  `PASS: isolated schema catalog verified (database=citefi_qa host=127.0.0.1 port=55481; no app DB touched)`.
* Node test concurrency was `1` and force-exit cleanup was enabled.
* The offline guard allowed only `127.0.0.1:55481` and the owned
  `127.0.0.1:16389` Redis fixture. No application server was started.
* The three separately maintained MFA/agency files containing the prior
  `51/51` result were not rerun.

The harness now supplies unusable QA-only OpenAI and Gemini sentinel strings
solely because some provider modules construct SDK clients during import.
These are not credentials. The offline guard still rejects every provider
request and no provider call, SMTP delivery, paid service, or external
network was used.

## Final command

The final accepted command was one shared child batch:

```sh
QA/support/with-isolated-database.sh --with-redis -- \
  tests/auth/password-recovery-security.test.ts \
  tests/auth/invite-concurrency.test.ts \
  tests/security/tenant-rls.test.ts \
  tests/security/conversion-webhook.test.ts \
  tests/billing/stripe-credit-reconciliation.test.ts \
  tests/batches/batch-submission-claim.test.ts \
  tests/pipeline/budget-stop-cleanup.test.ts \
  tests/pipeline/pipeline-worker.test.ts \
  tests/pipeline/video-idea-quota-retry.test.ts
```

Final runner receipt:

```text
# tests 45
# suites 1
# pass 45
# fail 0
# cancelled 0
# skipped 0
# todo 0
HARNESS_EXIT=0
isolated PostgreSQL: cleanup complete (owned cluster stopped; active fixture connections=0)
isolated Redis: cleanup complete (owned process stopped; port=16389)
```

The raw TAP and harness output is retained at
[`extended-database-execution.log`](extended-database-execution.log).

## Successful outcomes

| File | Cases | Pass | Fail | Scope |
| --- | ---: | ---: | ---: | --- |
| `tests/auth/password-recovery-security.test.ts` | 2 | 2 | 0 | Reset-code disclosure and controlled admin recovery source contracts |
| `tests/auth/invite-concurrency.test.ts` | 2 | 2 | 0 | Atomic invite acceptance and final-seat contention against fixture PostgreSQL |
| `tests/security/tenant-rls.test.ts` | 8 | 8 | 0 | Tenant RLS, pooled context isolation, worker scope, and client-reviewer permissions |
| `tests/security/conversion-webhook.test.ts` | 1 | 1 | 0 | Signed conversion ownership, tenant RLS, and cross-team rejection |
| `tests/billing/stripe-credit-reconciliation.test.ts` | 2 | 2 | 0 | Pure cumulative-refund and dispute reversal accounting |
| `tests/batches/batch-submission-claim.test.ts` | 7 | 7 | 0 | Atomic claim, cancellation-safe acknowledgement, reservation, compensation, and child enqueue recovery |
| `tests/pipeline/budget-stop-cleanup.test.ts` | 3 | 3 | 0 | Article/video budget-stop cleanup and tenant-attributed telemetry |
| `tests/pipeline/pipeline-worker.test.ts` | 14 | 14 | 0 | Retry taxonomy, reservation release/debit behavior, and run-budget gates |
| `tests/pipeline/video-idea-quota-retry.test.ts` | 6 | 6 | 0 | Disabled media, quota retry, reservation settlement, and durable debit recovery |
| **Total** | **45** | **45** | **0** | **Fixture-only result** |

The provider-looking errors printed by budget and retry tests are deliberate
synthetic inputs asserted by the tests. They did not invoke a provider.

## Redis-dependent boundary

`tests/pipeline/restart-crash-boundaries.test.ts` was inspected and requires
real BullMQ/ioredis delivery for its two redelivery cases. The harness was
extended with an opt-in `--with-redis` mode that owns only
`127.0.0.1:16389`, passes `REDIS_URL` only to that child batch, and stops only
the Redis process it starts. This mode was exercised in a retained exploratory
receipt:
[`extended-database-execution.redis.log`](extended-database-execution.redis.log).

That Redis batch produced 8 cases, 6 pass, and 2 failures. Both failures are
test-fixture incompatibilities, not a feature-pass claim: the fake article
payloads are now rejected by the production article validator as too short and
missing a markdown heading, after which the test's cleanup helper does not
remove all dependent rows. No provider request occurred. The exact failures
are retained as `not ok` entries in the Redis receipt and are not folded into
the final `45/45` result.

The already-maintained helper-owned queue acceptance on `127.0.0.1:16379`
was not rerun.

## Explicitly blocked HTTP suites

These suites were not included and remain blocked:

* `tests/auth/auth-api.test.ts` — sends HTTP requests to an existing
  `localhost:5000` server.
* `tests/admin/admin-notifications.test.ts` — also requires HTTP
  `localhost:5000` and has no safe in-process controller path.

No duplicate application server was launched and the offline guard was not
widened to permit port `5000`.

Earlier harness-setup attempts that stopped at provider SDK import-time
credential checks are retained as
`extended-database-execution.initial.log` and
`extended-database-execution.second.log`; they are not test outcomes. The
final harness-only sentinel adjustment enabled the accepted `45/45` run.