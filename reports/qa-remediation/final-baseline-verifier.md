# Final Scope 0 baseline verifier — RC2–RC5 source-change pass

## Decision

**PASS for the deterministic Scope 0 regression baseline: 39/39 pass, 0
failures.**

Five revised suites were inspected and executed in separate direct Node
processes. They produced **32/32 pass, 0 fail**. The two unchanged Scope 0
suites were not rerun, as directed; their architect-verified results remain
**7/7 pass** (`scope-0-pass-features.test.ts` 5/5 and
`scope-0-pure-pass-features.test.ts` 2/2). The current targeted baseline is
therefore **39 tests: 39 pass, 0 fail**.

This is deterministic mocked-test evidence only. It is not a live-provider,
network, database, queue, browser, workflow, or production-readiness
certification. Historical feature statuses remain unchanged.

## Files inspected and execution scope

All seven Scope 0 test files were inspected for executable behavior and mock
boundaries:

1. `tests/scope-0-seo-routes.test.ts` — executed, 14 tests.
2. `tests/scope-0-content-audit.test.ts` — executed, 5 tests.
3. `tests/scope-0-campaign-confirm-route.test.ts` — executed, 5 tests.
4. `tests/scope-0-campaign-confirm-service.test.ts` — executed, 3 tests.
5. `tests/scope-0-brand-intelligence-route.test.ts` — executed, 5 tests.
6. `tests/scope-0-pass-features.test.ts` — unchanged, not rerun; retained
   architect-verified 5/5.
7. `tests/scope-0-pure-pass-features.test.ts` — unchanged, not rerun; retained
   architect-verified 2/2.

The five executed files were run one at a time, each in its own direct Node
process, using the repository-documented loader and module-mocking runner.
No aggregate multi-file test invocation or test IPC path was used.

## Commands and observed counts

### TypeScript check

RC4 records the preceding successful typecheck; RC5 then changed source files
without recording a later typecheck. Because source changed after the last
worker typecheck, this pass ran the check exactly once:

```text
npx tsc --noEmit --pretty false
```

Observed result: exit 0, no compiler output.

### Executed Scope 0 suites

Each command below exited 0. The experimental loader/module-mocking warnings
were expected and excluded from the test counts.

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-seo-routes.test.ts
```

```text
tests 14
pass 14
fail 0
cancelled 0
skipped 0
todo 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-content-audit.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-route.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-campaign-confirm-service.test.ts
```

```text
tests 3
pass 3
fail 0
cancelled 0
skipped 0
todo 0
```

```text
node --env-file=.env.local --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test --test-concurrency=1 tests/scope-0-brand-intelligence-route.test.ts
```

```text
tests 5
pass 5
fail 0
cancelled 0
skipped 0
todo 0
```

Executed subtotal: **32 tests, 32 pass, 0 fail**. Retained unchanged subtotal:
**7 tests, 7 pass, 0 fail**. Final baseline: **39 tests, 39 pass, 0 fail**.
There was no new test failure. The prior aggregate content-audit
cloned-data/Node-test-IPC failure documented by the Scope 0 verifier remains
historical; this pass neither reran nor erased that aggregate result.

## Mock-boundary review

- SEO route tests execute the actual route handlers while replacing auth and
  SEO service boundaries with deterministic callbacks. Service inputs,
  authentication, status handling, and serialized responses are asserted.
- Content Audit executes the production audit service and route. Database reads
  return fixture rows; insert, update, and delete throw if reached. The
  OpenAI callback, cost-accounting check, and authentication boundary are
  deterministic doubles.
- Campaign confirmation service tests execute the production service against a
  read/update recorder. Drizzle predicates are compiled and checked for
  tenant, campaign, and non-deleted conditions; no database driver is used.
- Campaign confirmation route tests execute the actual handler while auth and
  campaign-service calls are deterministic doubles, including call ordering
  and tenant/public-ID threading.
- Brand Intelligence route tests execute the actual handler while auth,
  profile repository, campaign lookup, queue, and campaign-sync boundaries are
  mocked. Queue and sync doubles only record arguments and ordering.
- The two unchanged suites were not rerun. Their previously verified counts
  are retained without representing them as fresh execution in this pass.

The exercised branches therefore made no provider request, paid call, network
request, queue operation, database-driver operation, or database write. This
boundary observation is limited to the mocked paths above; it is not syscall-
level network proof and does not establish live behavior.

## Stop condition

No provider, network, database write, browser, workflow restart, dependency
installation, migration, or production-code change was performed for this
baseline. Stop for principal/architect review. Do not upgrade historical
statuses or make live claims from this report.