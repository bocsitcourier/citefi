# RC5 Worker QA / Remediation Report

## Scope and authorization

This pass addresses only the remaining agency-report concurrency defect. RC4
source approval is preserved; no RC4 provider, media, or paid journey work was
performed. The narrowly authorized additive migration was applied to the
verified development QA database only. The live concurrency attempt used only
temporary synthetic fixtures and removed them through the existing test
teardown; no existing customer rows were changed.

## Root cause

`createAgencyClientReport` previously ran at `REPEATABLE READ` and relied on
`ON CONFLICT DO NOTHING` for idempotency. On deployed databases where
`agency_client_reports` was created by `db:push` before migration 0019, the
period unique index could be absent even though it was declared in
`shared/schema.ts` and in the clean-install portion of migration 0019. Eight
requests could therefore observe no row and insert duplicate reports, each
with a financial snapshot.

The existing migration already has the composite `(id, agency_team_id,
client_team_id)` target needed by the financial snapshot foreign key, but it did
not retrofit the period uniqueness contract onto this deployed-schema path.

## Source controls implemented

- Report creation now uses `READ COMMITTED`, with the existing bounded
  whole-transaction retry policy. Only PostgreSQL `40001` serialization
  failures and `40P01` deadlocks retry; the callback, authorization,
  evidence reads, hashes, report insert, and financial insert are replayed from
  the beginning. The bound remains five retries.
- The insert uses the explicit
  `(agency_team_id, client_team_id, period_start, period_end)` conflict target,
  so idempotency is for the exact agency/client/period tuple.
- If PostgreSQL returns an insert conflict that is not visible in the current
  transaction statement snapshot, the code reclassifies that unresolved view as
  `40001` so the same bounded whole-transaction retry handles it.
- Each generation transaction now computes a versioned canonical JSON tuple of
  agency, client, period start, and period end, then takes
  `pg_advisory_xact_lock(hashtextextended(..., 0))` after authorization and
  readiness checks and before the existing-row read. This is transaction-scoped
  coordination only: there is no global or in-process lock, no retry-bound
  increase, and no split financial transaction.
- The direct-child agency/client authorization check remains inside every
  transaction attempt. Financial snapshot reads repeat the agency/client
  predicates, and the financial relation's existing `report_id` primary key
  keeps one financial snapshot per report.
- Generation performs a read-only `pg_index` preflight for the exact required
  `agency_client_reports_period_unique` unique index and exact ordered key
  columns. It requires `indisunique`, `indisvalid`, `indisready`, exact
  `public.agency_client_reports` schema/table identity, four key attributes,
  no predicate, and no expressions. Missing, non-unique, invalid, not-ready,
  partial, expression-based, or differently ordered indexes fail explicitly
  with typed `SCHEMA_NOT_READY` and HTTP 503; there is no unsafe fallback,
  request-time DDL, generic 500, or PostgreSQL `42P10` translation.
- `withBoundedTransactionRetry` is now the shared, testable implementation of
  the existing `40001`/`40P01` whole-transaction policy used by
  `withTenantTransaction`.

Architect diagnosis confirmed that `SERIALIZABLE` took its snapshot during the
catalog/auth work before the advisory lock, so a waiter could still see a
stale `alreadyCreated` result after acquiring the lock. The final correction is
only the transaction isolation setting: `READ COMMITTED` retains fresh
statement snapshots while preserving the exact advisory lock key, unique-index
idempotency, config `FOR SHARE`, one SQL evidence aggregate snapshot, atomic
report/financial writes, and the bounded retry policy. Read-only catalog/RLS
verification did not identify RLS as the cause. Earlier `SERIALIZABLE` failures
remain recorded below rather than being overwritten.

## Migration applied under authorized QA scope

`migrations/0034_agency_report_period_unique.sql` is an additive, idempotent
schema prerequisite for databases that missed the period index. It:

1. fails clearly if the report table is absent;
2. checks for duplicate agency/client/period groups before DDL;
3. raises without deleting or rewriting any rows when duplicates exist; and
4. creates `agency_client_reports_period_unique` only when absent.

The verified runtime selection used `DATABASE_URL` (not the separately present
provider-named fallback) and matched the development database identity
`heliumdb` / role `postgres`; it was not a managed production target and was
not the existing external provider database. Read-only preflight confirmed QA
team IDs `2535`, `2567`, and `2568` (with `2568` as the direct child of
`2567`), report ID `80` count `1`, and financial snapshot report ID `80` count
`1`. Duplicate agency/client/period groups were `0` with `0` excess rows.

The established versioned runner was invoked with start version `0034`. It
applied only `0034_agency_report_period_unique.sql`; the prior 14 tracked
versions were present with matching checksums, and 0034's ledger checksum
matched the source after application. The runner's pre-0020 objects remain
owned by their established separate migration scripts; none was selected or
run in this pass. No other migration was pending in the selected runner scope
or applied.

## Simulated concurrency evidence (no database)

The new controlled transaction-double suite passed:

```text
node --import tsx/esm --test \
  tests/agency-report-service.test.ts \
  tests/agency-report-concurrency.test.ts \
  tests/agency-report-routes.test.ts
```

All 18 tests passed. The controlled, versioned in-memory transaction double
ran eight parallel requests for one agency/client/period and demonstrated one
report ID, one insert result, and one financial snapshot. It separately
injected `40001` and `40P01`, confirmed whole-callback replay, propagated a
non-retryable error, and stopped at the bounded attempt count. Service
regressions cover a valid catalog result, a same-named invalid/not-ready result,
an absent result, and the versioned canonical lock tuple/order; the route
regression confirms typed 503 exposure without 500 or `42P10`.

This is simulated orchestration evidence only. It is not a PostgreSQL
serialization pass and does not upgrade the live agency-report feature grade.

## Existing non-DB regression evidence

The existing deterministic checks also passed:

```text
node --import tsx/esm --test \
  tests/campaigns/campaign-ads-contract.test.ts \
  tests/article-output-safety.test.ts
```

All 21 tests passed. Campaign-ad Date canonicalization remains covered, and
the retained immutable legacy hash failure remains asserted rather than
rewritten. Existing batch/campaign ZIP eligibility and archiver route wiring
remain covered. No plain batch ZIP manifest feature, PDF feature, provider
call, journey run, learning claim, or paid operation was added.

RC6 remains unchanged: the existing archiver adapter/import and deterministic
regression evidence was collected only. A direct non-DB import smoke check also
passed (`zip adapter import ok`); no new adapter behavior was required.

## Real-DB verification and concurrency outcome

The existing `tests/agency-reports.integration.test.ts` already supplies the
real PostgreSQL fixture and eight-way generation procedure. It now has an
explicit `pg_index` readiness assertion. Read-only post-migration catalog
verification found exactly one same-named
index with `indisunique=true`, `indisvalid=true`, `indisready=true`,
`indnkeyatts=4`, `indnatts=4`, no predicate, no expressions, and ordered
catalog key attributes `2 3 5 6`; the full readiness predicate returned
`true`. Duplicate groups remained `0`.

The authorized concurrency command was:

```text
AGENCY_REPORT_CONCURRENCY_ONLY=true node --env-file=.env.local \
  --import tsx/esm --test \
  --test-name-pattern='Task 154 agency reports enforce accounting' \
  tests/agency-reports.integration.test.ts
```

The `AGENCY_REPORT_CONCURRENCY_ONLY` gate was an ephemeral test-run selector
used only to execute the first nested concurrency case; it was removed after
the run and is not an application or retained test behavior.

Before the lock fix, the eight-way attempt used synthetic fixture teams
`2717`, `2718`, and `2719` and failed with PostgreSQL `40001` (`could not
serialize access due to concurrent update`) after the existing bounded retry
limit. After the versioned transaction-scoped lock was added, this one
authorized rerun used fresh synthetic fixture teams `2720`, `2721`, and
`2722`; it made no email or provider/network call and failed again with the
same `40001` after the unchanged retry bound. The failing insert was reached
after the lock call. Each test runner result reported 2 failed tests (the
nested test and its parent), with no successful one-ID/one-insert/one-financial
snapshot result to count. Retry controls were not changed in response. This is
recorded as a live QA failure requiring review, not as a passing concurrency
gate. Post-teardown read-only verification returned fixture team count `0` and
fixture report-row count `0` for both fixture ID ranges.

Failure metadata was captured read-only against the same safe target identity:
8 requests, existing `maxRetries=5`, SQLSTATE `40001`, PostgreSQL message
`could not serialize access due to concurrent update`, and failure at the
`agency_client_reports INSERT ... ON CONFLICT DO NOTHING` statement class.
After teardown, active advisory-lock count was `0`, fixture team count was `0`,
and fixture report count was `0`.

Following architect 248's snapshot diagnosis, the sole authorized rerun after
the one-line `READ COMMITTED` correction passed the same isolated nested test:
2 tests passed, with fresh synthetic fixture teams `2723`, `2724`, and `2725`,
one generated report ID `95`, one `inserted=true` result, and one financial
snapshot row for that report during the test assertions. The existing teardown
removed all three fixture teams and the report/snapshot rows; post-teardown
read-only verification found candidate fixture team count `0`, candidate
fixture report count `0`, and active advisory-lock count `0`. The report ID is
retained here as a safe identifier only; no customer row contents are recorded.

No other application/customer rows were changed, no duplicate repair or
cleanup was performed, no other migration was applied, no dependency or
provider call was made, and no workflow restart occurred. Stop for architect
review.