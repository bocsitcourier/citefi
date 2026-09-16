# Generation test and harness maintenance

Date of this maintenance pass: 2026-09-16.

This is a test/harness-only correction. No production source was changed for
the generation audit fixes below.

## Architect decisions preserved

- The public branding change from git `73e13ba` is intentional. The governance
  tests now assert the current local marketing campaign engine for agencies
  and local businesses, grounded in business context, reviewable work, and
  clearly separated (human-controlled) external action. They also assert that
  the deferred “complete local marketing campaigns from one business URL”
  claim is absent. The layout was not reverted.
- The extra batch lookup is intentional legacy compatibility from git
  `6939f8d` (legacy ID preflight). The enqueue test records ordered lookup IDs
  (`batch:28`, then four `batch-28` confirmation reads) and separately proves
  that finding `batch:28` avoids `Queue.add`. It no longer treats a read count
  of four as the contract.
- Scope-0 content-audit tests mock the receipt core at the receipt boundary,
  rather than adding `getTxDb` to a broad fake database. Scope-0 SEO tests
  mock the Gemini submission adapter at its boundary, so receipt persistence
  and `pg.Pool` imports cannot be mistaken for route/service coverage.
- Scope-0 commands use the alias loader, the offline guard, and
  `QA/support/qa-fixtures.mjs`; they do not load `.env` files, provider
  credentials, an application queue, or a database. Fixture database values
  are non-routable and all provider/Redis access remains blocked unless a
  command explicitly opts into the owned Redis port.

Prior red logs are retained unchanged, including:

- `run-scope-mocks.log`
- `run-scope-pass.log`
- `run-scope-pass-loader.log`
- `run-static-a.log`
- `run-static-a-fixture.log`
- `run-static-b.log`
- `run-static-b-fixture.log`
- `run-regression-metadata.log`

The new TAP evidence files below are additional evidence, not replacements for
the first-pass failures.

## Scope-0 commands and acceptance

Each command was run in a fresh Node process, separately, with no test name
patterns, skips, TODOs, or disabled assertions:

```sh
NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-brand-intelligence-route.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-campaign-confirm-route.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-campaign-confirm-service.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-content-audit.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-pass-features.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --experimental-test-module-mocks --import tsx/esm --test \
  tests/scope-0-seo-routes.test.ts

NODE_ENV=test node --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs \
  --experimental-loader ./tests/scope-0-alias-loader.mjs \
  --import tsx/esm --test tests/scope-0-pure-pass-features.test.ts
```

| Fresh suite | Tests | Pass | Fail | Skipped | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Brand Intelligence route | 5 | 5 | 0 | 0 | `scope-0-brand-intelligence-route.new.tap` |
| Campaign confirm route | 5 | 5 | 0 | 0 | `scope-0-campaign-confirm-route.new.tap` |
| Campaign confirm service | 3 | 3 | 0 | 0 | `scope-0-campaign-confirm-service.new.tap` |
| Content audit | 5 | 5 | 0 | 0 | `scope-0-content-audit.new.tap` |
| PASS features | 5 | 5 | 0 | 0 | `scope-0-pass-features.new.tap` |
| SEO routes | 14 | 14 | 0 | 0 | `scope-0-seo-routes.new.tap` |
| Pure PASS features | 2 | 2 | 0 | 0 | `scope-0-pure-pass-features.new.tap` |
| **Total** | **39** | **39** | **0** | **0** | 7 fresh processes |

## Real isolated Redis acceptance

`tests/helpers/isolated-redis.ts` now starts a test-owned Redis process on
`127.0.0.1:16379`, creates an explicit ioredis connection without reading
`REDIS_URL`, and stops only the child process it started. The offline guard
allows port `16379` only for these commands. No application Redis process or
queue was used.

The requested five queue-ID acceptance tests were run as four fresh commands:
the custom-ID file contains two tests, making the total five. No test was
skipped.

```sh
NODE_ENV=test QA_TEST_ALLOWED_PORTS=16379 node \
  --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs --import tsx/esm --test \
  tests/batches/queue-real-id.test.ts

NODE_ENV=test QA_TEST_ALLOWED_PORTS=16379 node \
  --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs --import tsx/esm --test \
  tests/batches/video-queue-real-id.test.ts

NODE_ENV=test QA_TEST_ALLOWED_PORTS=16379 node \
  --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs --import tsx/esm --test \
  tests/batches/queue-custom-id-contract.test.ts

NODE_ENV=test QA_TEST_ALLOWED_PORTS=16379 node \
  --import ./QA/support/qa-fixtures.mjs \
  --import ./QA/support/offline-guard.mjs --import tsx/esm --test \
  tests/podcast-queue-real-add.test.ts
```

| Isolated queue-ID acceptance | Tests | Pass | Fail | Skipped | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| Batch/article/image/daily-brief IDs | 1 | 1 | 0 | 0 | `queue-real-id.isolated.new.tap` |
| Video idea/social video IDs | 1 | 1 | 0 | 0 | `video-queue-real-id.isolated.new.tap` |
| Canonical/bulk/dedupe/billing IDs | 2 | 2 | 0 | 0 | `queue-custom-id-contract.isolated.new.tap` |
| Podcast IDs and ambiguity recovery | 1 | 1 | 0 | 0 | `podcast-queue-real-add.isolated.new.tap` |
| **Total** | **5** | **5** | **0** | **0** | 4 fresh processes |

The two legacy real-Redis suites that previously targeted `6379` were also
parameterized and run against the same owned fixture:

| Legacy suite | Result | Evidence |
| --- | --- | --- |
| `tests/pipeline/canary-worker.test.ts` | 27/27 checks passed | `canary-worker.isolated.new.tap` |
| `tests/pipeline/provider-circuit-breaker.test.ts` | 4/4 tests passed | `provider-circuit-breaker.isolated.new.tap` |
