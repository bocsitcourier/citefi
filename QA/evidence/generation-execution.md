# Generation execution QA — first audit pass

Scope: `tests/pipeline/*`, `tests/batches/*`, `tests/campaigns/*`,
`tests/governance/*`, and the owned top-level article, generation, social,
podcast, video/Veo, brand-intelligence, and `scope-0` tests. This is an
offline/static first pass; it is **not** full-feature or live-generation
verification.

## Safety and setup

- Node `v20.20.0`; every executed Node test was preloaded with
  `QA/support/offline-guard.mjs`.
- The guard denied external sockets and `fetch`. No provider, external
  publication, advertising, email, customer-data write, workflow restart, or
  application DB/Redis service was used.
- No `.env` file was loaded and no secret value was printed. Tests that only
  needed module initialization used a non-routable QA fixture DB value; no
  connection was permitted.
- Owned Redis tests were inspected first. The repository fixtures hard-code
  ports `6379` or `16379`; these were not run. The sandbox permits only an
  explicitly owned temporary Redis on `16389`, and no temporary Redis was
  required for the static pass.
- DB-writing/integration tests were inspected and recorded as blocked rather
  than run: `batch-submission-claim`, `campaign-migration`,
  `campaign-service`, `budget-stop-cleanup`, `restart-crash-boundaries`,
  `pipeline-worker`, and `video-idea-quota-retry`.
- The new regression test is intentionally failing. No implementation change
  was made.

## Test commands and machine counts

All paths below are repository-relative. Exit counts are preserved in the
corresponding log, including failed runs.

| Command scope | Exit | Machine count | Output |
| --- | ---: | --- | --- |
| Initial static group, no fixture initialization | 1 | 54 tests: 44 pass, 10 fail | `QA/evidence/run-static-a.log` |
| Initial Redis/social group under guard | 1 | 3 tests: 0 pass, 3 fail | `QA/evidence/run-static-b.log` |
| Static group with non-routable QA module-init fixtures | 1 | 94 tests: 92 pass, 2 fail | `QA/evidence/run-static-a-fixture.log` |
| Social plus real-Redis queue group under guard | 1 | 18 tests: 16 pass, 2 blocked by guard | `QA/evidence/run-static-b-fixture.log` |
| Scope-0 route/service mocks with alias loader | 1 | 32 tests: 27 pass, 5 harness failures | `QA/evidence/run-scope-mocks.log` |
| Scope-0 pass-feature mocks, documented runner (no alias loader) | 1 | 5 tests: 0 pass, 5 harness failures | `QA/evidence/run-scope-pass.log` |
| Scope-0 pass-feature mocks, corrected alias-loader runner | 1 | 5 tests: 0 pass, 5 harness failures | `QA/evidence/run-scope-pass-loader.log` |
| Queue contract static subset only | 0 | 2 tests: 1 pass, 1 explicitly skipped by name pattern | `QA/evidence/run-queue-contract-static.log` |
| New metadata regression reproduction | 1 | 1 test: 0 pass, 1 fail | `QA/evidence/run-regression-metadata.log` |

The static-subset result is not a pass for the real Redis test. The omitted
Redis subtest remains **BLOCKED/UNSAFE PORT**, not skipped to claim coverage.

## Executed test-file coverage

### Static pass coverage

The following owned files completed their deterministic/mock/static assertions
in `run-static-a-fixture.log` unless otherwise noted:

- `tests/article-output-safety.test.ts`
- `tests/pipeline/delivery-settlement-contract.test.ts`
- `tests/pipeline/execution-contract.test.ts`
- `tests/pipeline/restart-safety.test.ts`
- `tests/batches/batch-progress.test.ts`
- `tests/batches/cap-reservation-contract.test.ts`
- `tests/batches/requeue-billing-contract.test.ts`
- `tests/batches/regenerate-titles-auth.test.ts`
- `tests/batches/veo-idea-script-contract.test.ts`
- `tests/batches/video-script-contract.test.ts`
- `tests/campaigns/campaign-ads-contract.test.ts`
- `tests/generation-finalization-gate.test.ts`
- `tests/podcast-duration.test.ts`
- `tests/brand-intelligence-validation.test.ts`
- `tests/video-billing-contract.test.ts`
- `tests/scope-0-pure-pass-features.test.ts`
- `tests/social-generation-contract.test.ts` (16 deterministic assertions in
  `run-static-b-fixture.log`)
- the canonical-ID subtest in
  `tests/batches/queue-custom-id-contract.test.ts` (the real Redis subtest is
  separately blocked)

These results are static/mock contract coverage only. They do not certify
providers, queues, durable retrieval, playback, or live billing.

### Failing or blocked file coverage

- `tests/batches/batch-submission.test.ts`: 1 current failure; ambiguous
  enqueue observation count is `5`, while the test expects `4`. The extra
  lookup is the current legacy-ID preflight in `lib/queue.ts`; this is a
  current source/test contract mismatch and needs ownership review.
- `tests/governance/launch-governance.test.ts`: 1 current failure; its public
  metadata contract expects `Local SEO Content Platform for Agencies`, while
  current `app/layout.tsx` contains different current positioning. This is a
  confirmed static contract mismatch, not a live feature claim.
- `tests/governance/public-metadata-title-regression.test.ts`: intentionally
  reproduces the metadata mismatch; it fails in
  `run-regression-metadata.log`.
- `tests/batches/queue-real-id.test.ts` and
  `tests/batches/video-queue-real-id.test.ts`: **BLOCKED_GUARD** because the
  tests attempt Redis on application port `6379`.
- The real Redis subtest in
  `tests/batches/queue-custom-id-contract.test.ts` and
  `tests/podcast-queue-real-add.test.ts`: **BLOCKED_UNSAFE_PORT** because the
  repository fixture uses `16379`, not the authorized `16389`.
- `tests/pipeline/canary-worker.test.ts` and
  `tests/pipeline/provider-circuit-breaker.test.ts`: **BLOCKED_UNSAFE_PORT**
  because they target application Redis `6379`.
- `tests/scope-0-content-audit.test.ts`: 5 **BLOCKED_HARNESS** failures. Its
  DB test double does not export `getTxDb`, and later mocked module links fail
  for `openai-client`; no application behavior was reached.
- `tests/scope-0-pass-features.test.ts`: 5 **BLOCKED_HARNESS** failures. The
  documented runner lacks the `@/` alias loader; the corrected runner reaches
  a second test-double failure because the mocked `pg` module lacks `Pool`.
- `tests/batches/batch-submission-claim.test.ts`,
  `tests/campaigns/campaign-migration.test.ts`,
  `tests/campaigns/campaign-service.test.ts`,
  `tests/pipeline/budget-stop-cleanup.test.ts`,
  `tests/pipeline/pipeline-worker.test.ts`,
  `tests/pipeline/restart-crash-boundaries.test.ts`, and
  `tests/pipeline/video-idea-quota-retry.test.ts`: **BLOCKED_DB_WRITE**;
  setup creates/updates/deletes PostgreSQL fixtures and was not executed.

The initial logs additionally document expected harness/guard failures before
the safe QA module-init fixture was supplied. Those failures are retained and
not reclassified as application defects.

## Coverage of all 40 inventory names

Statuses below describe this audit pass, not historical live evidence. `STATIC`
means deterministic/mock assertions only. `BLOCKED` means setup, provider,
DB, queue, or authorization prevented safe execution. `NOT_TESTABLE` is the
current source classification for unsupported surfaces.

| # | Inventory feature | This-pass status | Owned evidence |
| ---: | --- | --- | --- |
| 1 | Article title pool and topic research | BLOCKED | batch/provider path requires DB/provider |
| 2 | Batch article generation | BLOCKED | worker/DB/provider path not safe offline |
| 3 | Single article regeneration | BLOCKED | provider/DB path not safe offline |
| 4 | Batch title regeneration | STATIC | `regenerate-titles-auth.test.ts` |
| 5 | Article metadata regeneration | BLOCKED | no safe provider/DB execution |
| 6 | Article reformatting | BLOCKED | no safe provider/DB execution |
| 7 | Article and batch hyperlink transforms | STATIC | article output/export safety contracts |
| 8 | Direct hero and media image regeneration | BLOCKED | provider/media path outside this safe pass |
| 9 | Batch image and caption repair | BLOCKED | queue/provider/media path not safe |
| 10 | Identity-based social/media image regeneration | BLOCKED | provider/media path not safe |
| 11 | Social text generation | STATIC | `social-generation-contract.test.ts` |
| 12 | Social variant regeneration | BLOCKED | provider/DB path not safe |
| 13 | Social image generation | STATIC | social normalizer/reuse contracts |
| 14 | Social slideshow video | BLOCKED | multi-provider queue path not safe |
| 15 | Idea video | STATIC | Veo/script/billing contract tests only |
| 16 | Like-this video | BLOCKED | external media/provider path forbidden |
| 17 | Podcast generation | STATIC | duration and queue-ID contracts only; real queue blocked |
| 18 | SEO content audit | BLOCKED_HARNESS | scope-0 content-audit mock setup failed |
| 19 | SEO local research | STATIC | scope-0 mocked route pass |
| 20 | SEO competitor analysis | BLOCKED | no owned safe execution |
| 21 | SEO schema markup | STATIC | scope-0 mocked route pass |
| 22 | SEO content structure | STATIC | scope-0 mocked route pass |
| 23 | SEO pillar and cluster planning | STATIC | scope-0 mocked route pass |
| 24 | SEO create articles | BLOCKED | creation/export/provider path not safe |
| 25 | Daily brief generation | BLOCKED | queue/provider/email path not safe |
| 26 | Campaign ad copy generation | STATIC | `campaign-ads-contract.test.ts` |
| 27 | Campaign brand confirmation and intelligence context | STATIC | scope-0 route/service mocks |
| 28 | Journey orchestration and recommendations | BLOCKED | no owned safe fixture execution |
| 29 | Learning, corpus mining and decisioning analysis | BLOCKED | no owned safe fixture execution |
| 30 | Admin incident AI analysis | BLOCKED | synthetic admin DB fixture not authorized |
| 31 | Admin SEO report generation | BLOCKED | authenticated admin/provider path not safe |
| 32 | Agency report rendering and delivery | BLOCKED | email/customer/report fixture path not owned |
| 33 | Content publication adapters | BLOCKED_UNSAFE | no external publication authorization |
| 34 | Landing-page generation | NOT_TESTABLE | current source has no generator contract |
| 35 | AI email-campaign generation | NOT_TESTABLE | current source has no generator contract |
| 36 | Live Google/Meta ad publishing and spend | NOT_TESTABLE | source provides export, not live publisher |
| 37 | Provider-backed image editing or inpainting | NOT_TESTABLE | current source exposes replacement generation only |
| 38 | Atomic article-to-all-channels flywheel | NOT_TESTABLE | no atomic orchestrator contract |
| 39 | Threads and YouTube generation contracts | NOT_TESTABLE | no current route/output contract |
| 40 | Standalone Brand Intelligence | STATIC | validation plus scope-0 mocked route/service tests |

## Defects and blockers before implementation

1. **Confirmed static metadata contract mismatch (new failing regression).**
   `app/layout.tsx` does not contain the canonical agency positioning required
   by the existing governance test and the new
   `public-metadata-title-regression.test.ts`. The current metadata uses
   “local marketing campaign engine” wording. This is a source-visible
   regression/contract mismatch; no live SEO claim is made.
2. **Batch enqueue test/source contract mismatch.**
   `enqueueBatchGenerationJob` currently performs a legacy-ID lookup before the
   four confirmation observations. The existing test expects four total reads
   but observes five. The behavior is reproducible in both fixture runs.
3. **Scope-0 harness blockers.**
   Content-audit mocks lack `getTxDb`/compatible linked exports; pass-feature
   mocks lack the `pg.Pool` export, and their documented command omits the
   alias loader. These prevent independent verification and must not be
   called application passes.
4. **Unsafe integration setup.**
   Several owned tests hard-code application Redis ports `6379`/`16379`.
   They remain blocked under the offline guard and were not redirected to an
   unauthorized service.

No implementation fix was applied in this pass. No feature is marked
`VERIFIED_PASS`; all static statuses above are intentionally limited to their
contract assertions.