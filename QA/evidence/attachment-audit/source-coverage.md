# Source, instruction and test coverage manifest

**Audit date:** 2026-10-08 UTC  
**Repository HEAD:** `3f8e15291a06d8630cea046fa924a38648f81529`  
**Purpose:** State exactly what was reviewed/run and prevent a targeted audit from being mistaken for whole-repository line coverage.

## 1. Instruction coverage

The user-supplied `attached_assets/Pasted-I-ve-combined-the-live-testing-instructions-from-your-a_1791491283799.txt` has 1,911 lines. The whole file was read from line 1 through line 1,911 without truncation.

Key requirements were separately cross-checked at:

| Instruction lines | Topic reviewed |
|---|---|
| 1–1,911 | Entire directive; safety constraints, feature expectations, test modes and deliverables |
| 135–175 | Credential placeholders and mandatory live-testing safety rules |
| 1,321–1,413 | The 14 required tests and test-runner requirements |
| 1,607–1,885 | Part 17 A–K final report, exact test status vocabulary, publishing/feature coverage, release readiness and no-code-change directive |
| 1,770–1,911 | Defect/performance/fact/security/cleanup/readiness requirements and final execution directive |

## 2. Initial source ranges reviewed (superseded by §6 for follow-up coverage)

This table records the initial pass, which was intentionally narrow. The follow-up line-by-line review is in §6 and supersedes older "not reviewed" statements where it lists complete files/ranges. A partial range is never a claim that the unlisted rest of a large file passed review.

| Source file | Lines / scope actually inspected | Review purpose and boundary |
|---|---|---|
| `app/api/jobs/batch-submit/route.ts` | 1–180 of 507 | Auth/team context, validation, idempotency, atomic claim/replay and start of billing/enqueue; later compensation/error handling not source-reviewed here. |
| `lib/worker.ts` | 850–965, 1,270–1,335, 1,690–1,745 of 6,785 | Article response validation/checkpointing and the speed-mode/final HTML finalization gate before `COMPLETE`; the remainder of worker source not line-reviewed. |
| `lib/article-output-safety.ts` | 1–320 | Full deterministic article output, URL, visible-text and word-bound implementation. |
| `lib/generation-finalization-gate.ts` | 1–208 | Full reviewed article/social final gate composition and failure behavior. |
| `app/api/social_posts/generate/route.ts` | 1–240 of 522 | Auth, request schema, platform canonicalization, campaign/article ownership, setup and idempotency entry. Not a full route review. |
| `app/api/social/video/generate/route.ts` | 1–277 | Full reviewed generation route: storage preflight, team, quota/cap, reserve, slot, job enqueue and queue failure paths. |
| `app/api/podcast/generate/route.ts` | 1–254 | Full reviewed route: team-scoped article, duration validation, lock, cap/credit reservation, queue ambiguity and compensation. |
| `lib/podcast-worker.ts` | 1–250 of 590 | Worker job/dependency contract, delivered-settlement/replay gate, script generation and early brand/orchestration logic. Audio merge, upload, and catch tail not source-reviewed here. |
| `lib/publishing/index.ts` | 1–245 and 243–580 | Full 580-line file reviewed, with overlapping segments: dispatch map, connection handling, website ping, job creation, callbacks and job processing. |
| `app/api/publishing/connections/route.ts` | 1–92 | Full connection API schema/create/list flow; accepted channel values and team auth. |
| `app/api/publishing/connections/[id]/test/route.ts` | 1–40 | Full connection-test route; auth and call into server-side test fetch. |
| `app/api/publishing/jobs/route.ts` | 1–191 | Full list/create/delete route, including tenant ownership checks and publishing job creation. |
| `lib/publishing/channels/website/adapter.ts` | 1–120, 127–254, 455–533 | Media type/URL handling, article validation/sanitization and outbound website publish request. The 664-line adapter’s omitted middle/tail is not claimed reviewed. |
| `app/api/schedules/route.ts` | 1–126 | Full route schema, schedule creation, cron parsing and next-run fallback. |
| `lib/scheduled-content-worker.ts` | 1–316 | Full reviewed schedule claim, queue/billing, completion/failure and recurring scheduler flow. |
| `tests/qa/article-full-chain.test.ts` | 1–521 | Full test source reviewed: owned test setup, fake network/provider boundaries, assertions and cleanup. |
| `QA/support/article-chain-fixture.ts` | 1–955 | Full fixture source reviewed for disposable local services, environment isolation, network guard and cleanup. |
| `tests/qa/media-route-worker-fullchain.test.ts` | 1–1,243 | Full fixture/test source now reviewed: owned infrastructure, network guard, canonical security bootstrap, injected media, all 5 media-chain tests and teardown. |
| `tests/security/url-validation-independent.test.ts` | 1–374 | Full test source now reviewed, including safe DNS/HTTP/HTTPS cases and raw-fetch-sink contract assertions. |
| `tests/security/url-validation-ssrf-regression.test.mjs` | 1–12 | Full small regression test reviewed. |
| `package.json` | `scripts` object | Test/build/check/database/migration script safety selection. |
| `tsconfig.json` | 1–54 | Full config; noEmit/incremental behavior and whole-project include/exclude. |
| `shared/schema.ts` | Search hits only (`rg`) | Located exports for teams, users, batches, articles, publishing jobs/connections, schedules and provider receipts; no schema block was reviewed line by line. |

The exact defect locations and resulting impact are in `part-17-audit-report.md` §F. These ranges are sufficient to cite those observations but are not an exhaustive security review of the referenced flows.

## 3. Tests actually executed in this audit

All commands ran with a clean process environment (`env -i`) except the explicitly supplied no-network media fixture keys. No test read `.env.local`; no production/provider API credential was provided. Commands below are run boundaries, not arbitrary shell approximations.

### Article integration fixture

```sh
env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test \
  WORKER_PROCESS=true QA_TEST_ALLOWED_PORTS=5110,55490,16390 \
  node --import ./QA/support/article-chain-network.mjs \
  --import tsx/esm --test --test-concurrency=1 \
  tests/qa/article-full-chain.test.ts
```

- Exit: 0. TAP: 5 tests, 5 pass, 0 fail/skip/cancel; duration `47049.364351 ms`.
- Evidence: `article-full-chain.tap`.
- Fixture creates/owns local PostgreSQL `55490`, Redis `16390`, optional local HTTP `5110`; network guard only permits the owned loopback port. Provider requests use injected fixture transport. It covers authenticated route → real local queue/worker → DB persistence/retrieval, idempotent submit/charge, shared reservation race, malformed response/timeout non-publication, and single/non-replayable provider receipt behavior.
- It is **sandbox fixture** evidence, not a live Gemini request, real final judge, production object store, production account, or full multi-modal pipeline. The test’s injected review behavior and speed-mode settings limit what a passing artifact proves.

### Media route/worker integration fixture

```sh
env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test \
  WORKER_PROCESS=true LIVE_QA_IMAGE=0 \
  GEMINI_API_KEY=fixture-no-network OPENAI_API_KEY=fixture-no-network \
  GOOGLE_API_KEY=fixture-no-network \
  node --import tsx/esm --test --test-concurrency=1 \
  tests/qa/media-route-worker-fullchain.test.ts
```

- Exit: 0. TAP: 5 tests, 5 pass, 0 fail/skip/cancel; duration `27122.530222 ms`.
- Evidence: `media-route-worker-fullchain.tap`.
- Uses disposable local PostgreSQL `55488`, Redis `16388`, filesystem media storage and injected provider transport; `LIVE_QA_IMAGE=0`; the suite prevents external provider submissions. Fixture output includes repair, image route, video idea, like-video, and podcast paths. Article/page media is not certified from this.
- Test-generated video outputs were retained locally at `/tmp/veo-output/815/` and `/tmp/veo-output/816/`; both `with-audio.mp4` were read-only probed by `ffprobe` as MP4/H.264 1920×1080 + AAC, 11.52 s, 132,606 bytes. These are synthetic fixture/compositor outputs, not Veo/AI-generated clips.
- The podcast integration test passes 240 KB synthetic FFmpeg sine-wave MP3 fixture bytes to the worker and asserts ready state/URL, receipt, and debit. To validate a media file, the same 60 s FFmpeg fixture recipe (source lines 775–788) was separately generated as `/tmp/citefi-attachment-audit-fUaMMw/fixture.mp3` and parsed by `ffprobe`: MP3, 44.1 kHz, mono, 60.029388 s, 240,345 bytes. This does not prove the worker’s post-storage podcast bytes were re-downloaded or probed.
- After test teardown, locally owned ports 55488 and 16388 were confirmed closed.

### SSRF/helper regression fixture

```sh
env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test \
  node --import tsx/esm --test --test-concurrency=1 \
  tests/security/url-validation-independent.test.ts \
  tests/security/url-validation-ssrf-regression.test.mjs
```

- Saved run exit: 0. TAP: 14 tests, 14 pass, 0 fail/skip/cancel; duration `604.230752 ms`.
- Evidence: `url-validation-security.tap`.
- DNS, HTTP and HTTPS transports in these tests are stubbed. The suite does not contact the public Internet. Passing helper tests do not cover the separate website connection `fetch()` identified in F-01.

### TypeScript check

```sh
env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=test \
  ./node_modules/.bin/tsc --noEmit --incremental false
```

- Exit: 0, no output/diagnostics. This avoids incremental build-info output and performs no application DB/provider side effects.

### Deliberately not run

- `test:agency-reports` invokes tenant-RLS and migration scripts before its test; it was not run.
- `test:canary` and `test:state-machine` load `.env.local`; they were not run.
- `db:push`, `storage:migrate`, migrations/seed scripts, full application startup, and full worker startup were not run.
- The entire repository test suite, build/deploy, live application login, provider, user account, OAuth/publishing, webhook, schedule, browser QA dashboard, and cross-destination tests were not run.

## 4. Initial repository discovery and unreviewed areas (current gaps are in §6)

- A route-file inventory found **256** `app/api/**/route.ts` files. A broader source inventory recorded 547 files under the main application/server/library areas. These are discovery counts, not a statement that those files were read.
- Source/test inventory and symbols were searched for campaigns, auth/admin/client/agency, content and articles, media, social, video, podcast, publishing, schedules, billing, receipts, webhooks, analytics, learning and operations. Only the tabled ranges received focused source review.
- At the time of the initial pass, the items in the prior bullet had not been reviewed. Follow-up source ranges now cover specific auth, billing, campaign, worker, social, publishing/OAuth/webhook, storage, RLS/policy migrations found by the scan, gates and UI files; see §6 for exact coverage. That follow-up does not cover every API route, all non-RLS migrations, every administrative or analytics screen, full schema, all tests, or a whole-repository source review.
- The website channel is the only registered entry in the inspected publishing dispatch map; do not infer that other source modules or connection enums represent a functioning publisher.
- The separate public-browser observations in `live-public-audit.md` belong to the parent’s visitor-only check, not these local test commands. Signed-in browser UI and authenticated pages remain unverified.

## 5. Workspace and side-effect record

- No source code, app configuration, package, workflow, environment variable, deployed app, database migration, customer record, live queue, provider, publication, or remote media object was modified or created.
- Git changes produced for this delegated audit are the new evidence files in `QA/evidence/attachment-audit/`; the supplied test-instruction attachment is separately untracked input. No tracked application file was modified.
- Article/media local integration fixtures tore down their owned local databases, queues and ordinary temp roots. The article HTTP/DB/Redis and media DB/Redis test ports were confirmed closed.
- The four explicit local media output files above and the locally probed fixture MP3 remain in `/tmp`; no cleanup was performed.
- No live artifacts were created, so no remote publication cleanup was attempted or required.

## 6. Follow-up critical-code review: exact ranges reviewed

This is the current source-coverage record, superseding the relevant initial-pass gaps in §§2 and 4. Every complete-file claim below is a line-by-line review of the listed 1–N range. No statement here certifies the entire repository or production behavior. The original application remains read-only.

### Authentication, MFA, password recovery, sessions, CSRF and tenant context

| Source | Exact reviewed range | Coverage |
|---|---|---|
| `lib/api/auth.ts` | 1–877 | Authenticated context, role/team/resource predicates, request/rate-limit helpers and session controls. |
| `lib/auth.ts` | 1–270 | Password/authentication/session helpers. |
| `lib/csrf.ts` | 1–104 | CSRF token and request verification helpers. |
| `lib/session-policy.ts` | 1–11 | Session policy constants/helpers. |
| `lib/totp-security.ts` | 1–68 | TOTP/recovery security helpers. |
| `lib/tenant-context.ts` | 1–86 | Tenant context propagation and worker identity. |
| `lib/db.ts` | 1–445 | Database/client setup and request/team database helpers. |
| `app/api/auth/login/route.ts` | 1–320 | Login, password verification, MFA challenge and DB-backed rate limit. |
| `app/api/auth/verify-2fa/route.ts` | 1–212 | TOTP/email/recovery challenge attempts, consume and rate limits. |
| `app/api/auth/setup-totp/route.ts` | 1–325 | MFA setup and enrollment. |
| `app/api/auth/disable-totp/route.ts` | 1–134 | MFA disable checks and rate limits. |
| `app/api/auth/forgot-password/route.ts` | 1–117 | Recovery request and IP/email throttle. |
| `app/api/auth/reset-password/route.ts` | 1–141 | Password reset and rate limits. |
| `app/api/auth/reset-password-token/route.ts` | 1–209 | Reset-token validation/consumption and limits. |
| `app/api/auth/change-password/route.ts` | 1–180 | Authenticated password change and throttling. |
| `app/api/auth/send-email-code/route.ts` | 1–153 | Email-code flow and rate limits. |
| `app/api/auth/signup/route.ts` | 1–224 | Account creation and throttling. |
| `app/api/auth/logout/route.ts` | 1–69; `app/api/auth/me/route.ts` 1–146; `app/api/auth/team-context/route.ts` 1–124 | Logout, current identity and tenant selection. |

Source limits observed: login is 10 attempts/IP/15m; MFA verification is 5/IP and 5/user/15m with max 5 challenge attempts; forgot password 3/IP and 3/email/60m; reset and reset-token validation/apply have 5/IP and 5/email per 15m or 10/IP/15m for token validation; signup 5/IP/60m; email-code and setup-TOTP 5/IP and user/15m; disable-TOTP 3/IP and user/15m; change-password 5/IP. These are source settings, not an executed attack/rate-limit test.

### Tenant/RLS evidence reviewed (selected set only)

| Source | Exact reviewed range |
|---|---|
| `tests/security/tenant-rls.test.ts` | 1–469 |
| `migrations/0014_tenant_rls.sql` | 1–2,243 |
| `migrations/0014_tenant_rls_rollback.sql` | 1–651 |
| `migrations/0015_campaigns.sql` | 1–464 |
| `migrations/0015_campaigns_rollback.sql` | 1–94 |
| `migrations/0016_campaign_ads.sql` | 1–105 |
| `migrations/0017_provider_usage_ledger.sql` | 1–137 |
| `migrations/0019_agency_client_reports.sql` | 1–367 |
| `migrations/0019_agency_client_reports_rollback.sql` | 1–14 |
| `migrations/0025_credit_reservation_tenant_access.sql` | 1–27 |
| `migrations/0025_credit_reservation_tenant_access_rollback.sql` | 1–11 |
| `migrations/0031_generation_rls_drift_repair.sql` | 1–15 |
| `migrations/0034_provider_attempt_receipts.sql` | 1–105 |
| `migrations/0034_provider_attempt_receipts_rollback.sql` | 1–11 |
| `migrations/0035_provider_attempt_receipt_state_hardening.sql` | 1–184 |

All 13 migration files located by `rg -l -i 'row level security|create policy|alter policy|drop policy|force row level security|tenant access|tenant_rls' migrations --glob '*.sql'` were source-reviewed in full, including campaign, ad export, provider ledger and agency-report RLS. The entire migration tree (including migrations unrelated to RLS), schema file, and every route/policy/table are **not** covered; `shared/schema.ts` remained mostly search-only except the callback table block at 2,493–2,520. No RLS migration was executed in this follow-up.

### Credit lifecycle, paid-provider accounting, caps, receipts and settlement

| Source | Exact reviewed range |
|---|---|
| `lib/billing.ts` | 1–1,202 |
| `lib/credits.ts` | 1–387 |
| `lib/pipeline-billing.ts` | 1–43 |
| `lib/usage-caps.ts` | 1–326 |
| `lib/provider-usage-ledger.ts` | 1–511 |
| `lib/provider-attempt-receipts.ts` | 1–2,028 |
| `lib/gemini-attempt-receipt.ts` | 1–343 |
| `lib/brave-attempt-receipt.ts` | 1–225 |
| `lib/cost-telemetry.ts` | 1–828 |
| `lib/stripe-credit-reconciliation.ts` | 1–167 |
| `app/api/billing/webhook/route.ts` | 1–474 |
| `app/api/stripe/webhook/route.ts` | 1–23 (legacy endpoint response) |
| `lib/storage.ts` | 1–424 |
| `lib/storage-migration.ts` | 1–359 |
| `lib/provider-attempt-object-spool.ts` | 1–215 |

These source ranges cover reserve/debit/release/refund/grant/hold/reconciliation and cap/receipt/usage state-machine code, but do not constitute a live billing certification, all plan/subscription routes review, invoice reconciliation, migration execution, or whole-schema audit.

### Campaign identity, authorization, batch paths and campaign UI

| Source | Exact reviewed range |
|---|---|
| `lib/campaign-service.ts` | 1–1,354 |
| `lib/campaign-ads-service.ts` | 1–509 |
| `app/api/campaigns/route.ts` | 1–165 |
| `app/api/campaigns/[id]/route.ts` | 1–138 |
| `app/api/campaigns/[id]/confirm-brand/route.ts` | 1–65 |
| `app/api/campaigns/[id]/ads/route.ts` | 1–89 |
| `app/api/campaigns/[id]/ads/[adId]/approve/route.ts` | 1–37 |
| `app/api/campaigns/[id]/ads/[adId]/export/route.ts` | 1–71 |
| `app/api/campaigns/[id]/export/route.ts` | 1–257 |
| `app/api/jobs/batch-submit/route.ts` | 1–507 |
| `app/api/jobs/title-pool/route.ts` | 1–294 |
| `app/campaigns/page.tsx` | 1–23 |
| `app/campaigns/new/page.tsx` | 1–48 |
| `app/campaigns/[id]/page.tsx` | 1–62 |
| `app/campaigns/use-campaigns.ts` | 1–92 |
| `app/campaigns/components.tsx` | 1–65 |
| `app/campaigns/campaign-types.ts` | 1–104 |
| `app/campaigns/ads-lab.tsx` | 1–184 |
| `app/dashboard/page.tsx` | 1–1,273 |

The reviewed campaign paths propagate canonical campaign IDs through APIs/workers, and campaign ad approval paths distinguish client/policy/export authorities, enforce separated approvers and make the manifest export-only. The full content-generator dashboard provides campaign setup, title selection, credit preview, generation progress, and navigation to schedules/publishing/library; it is not a one-click end-to-end QA runner.

### Core worker, queue, scheduling and generation/finalization paths

| Source | Exact reviewed range |
|---|---|
| `lib/worker.ts` | 1–6,785 |
| `lib/social-worker.ts` | 1–1,542 |
| `lib/queue.ts` | 1–1,267 |
| `lib/podcast-worker.ts` | 1–590 |
| `lib/brief-scheduler.ts` | 1–146 |
| `lib/scheduled-content-worker.ts` | 1–316 |
| `app/api/schedules/route.ts` | 1–126 |
| `lib/article-output-safety.ts` | 1–320 |
| `lib/generation-finalization-gate.ts` | 1–208 |
| `app/api/social_posts/generate/route.ts` | 1–522 |
| `app/api/social/video/generate/route.ts` | 1–277 (from initial review) |
| `app/api/podcast/generate/route.ts` | 1–254 (from initial review) |

The content scheduler polls each 60 seconds (`lib/scheduled-content-worker.ts:10, 284–315`), unlike a separate spend-breaker five-minute poll. `"0 2 * * *"` UTC is used as a temporary atomic claim value at lines 28–51; configured cadence is used during normal completion/failure at lines 204–251.

### Social post API, all inspected social screens, and channel alternatives

| Source | Exact reviewed range |
|---|---|
| `app/api/social_posts/route.ts` | 1–63 |
| `app/api/social_posts/schedule/route.ts` | 1–102 |
| `app/api/social_posts/[id]/route.ts` | 1–301 |
| `app/api/social_posts/batch-delete/route.ts` | 1–89 |
| `app/social/page.tsx` | 1–18 (redirect) |
| `app/social/create/page.tsx` | 1–1,068 |
| `app/social/dashboard/page.tsx` | 1–783 |
| `app/social/[id]/page.tsx` | 1–1,657 |
| `app/settings/publishing/page.tsx` | 1–1,182 |
| `app/settings/publishing/jobs/page.tsx` | 1–12 (redirect) |
| `app/settings/publishing/job/page.tsx` | 1–5 (redirect) |

FB/LinkedIn/TikTok OAuth channel modules are present, while the reviewed publishing settings selector marks all three channels disabled/“Soon” (`app/settings/publishing/page.tsx:84–87, 862`). UI “Quick Share” actions on social details are manual share/copy flows, distinct from central provider publication. The detail page calls its `PATCH /api/social_posts/:id` scheduling route; that handler's weaker validation is F-06.

### Publishing, provider/channel adapters, OAuth, callbacks and webhooks

| Source | Exact reviewed range |
|---|---|
| `lib/publishing/index.ts` | 1–580 |
| `lib/publishing/types.ts` | 1–93 |
| `lib/publishing/auth/hmac.ts` | 1–53 |
| `lib/publishing/channels/website/adapter.ts` | 1–664 |
| `lib/publishing/channels/facebook/adapter.ts` | 1–199 |
| `lib/publishing/channels/linkedin/adapter.ts` | 1–204 |
| `lib/publishing/channels/tiktok/adapter.ts` | 1–210 |
| `lib/publishing/channels/social/oauth-service.ts` | 1–297 |
| `app/api/publishing/connections/route.ts` | 1–92 |
| `app/api/publishing/connections/[id]/test/route.ts` | 1–40 |
| `app/api/publishing/jobs/route.ts` | 1–191 |
| `app/api/publishing/jobs/[id]/retry/route.ts` | 1–70 |
| `app/api/publishing/callbacks/route.ts` | 1–190 |
| `app/api/oauth/facebook/authorize/route.ts` | 1–74; `callback/route.ts` 1–105 |
| `app/api/oauth/linkedin/authorize/route.ts` | 1–72; `callback/route.ts` 1–103 |
| `app/api/oauth/tiktok/authorize/route.ts` | 1–72; `callback/route.ts` 1–103 |

The channel adapter source includes provider request implementations, but `lib/publishing/index.ts` registers only `website`; OAuth/adapter existence is not proof of integrated dispatch. Website `testConnection`, `publish` and `verify` use ordinary outbound fetches instead of the shared pinned safe-fetch helper (F-01). Callback status defect is F-07. No actual receiver, OAuth provider, webhook or social destination was contacted.

### AI/media provider-client modules reviewed

| Source files | Exact complete ranges reviewed |
|---|---|
| Gemini | `lib/gemini.ts` 1–2,211; `lib/gemini-social.ts` 1–333; `lib/gemini-image-generator.ts` 1–673; `lib/gemini-social-image-generator.ts` 1–295; `lib/gemini-video-script-generator.ts` 1–646 |
| OpenAI | `lib/openai-client.ts` 1–483; `lib/openai.ts` 1–421; `lib/openai-social.ts` 1–257; `lib/openai-tts.ts` 1–110 |
| Veo / video | `lib/veo-idea-expander.ts` 1–380; `lib/veo-idea-orchestrator.ts` 1–358; `lib/veo-idea-script-generator.ts` 1–636; `lib/veo-video-generator.ts` 1–658; `lib/veo-social-video-generator.ts` 1–829; `lib/veo-video-tts-generator.ts` 1–225; `lib/veo-script-generator.ts` 1–304 |
| Social video clients | `lib/social-video-generator.ts` 1–428; `lib/social-video-image-generator.ts` 1–424; `lib/social-video-tts-generator.ts` 1–499 |

This lists the AI/media client modules reviewed in this audit, not every external integration, all provider behavior, or real paid execution.

### Review/QA UI and review endpoints

| Source | Exact reviewed range |
|---|---|
| `app/client/review/page.tsx` | 1–208 |
| `app/api/content/review/route.ts` | 1–55 |
| `app/api/content/[id]/approve/route.ts` | 1–105 |
| `app/api/review/chatgpt/route.ts` | 1–241 |

These expose review/approval and policy/generation actions; the inspected controls do not provide an integrated one-click full-pipeline/live QA inspector. This is limited to the enumerated pages/routes.

## 7. Additional tests run after initial coverage table

All suites used safe offline/owned-fixture, static, or mocked boundaries, not paid providers or public destinations. Actual TAP counts:

| Evidence file | Test cases | Pass | Fail | Skip | Caveat |
|---|---:|---:|---:|---:|---|
| `article-full-chain.tap` | 5 | 5 | 0 | 0 | Previously verified; not rerun after no app-source changes. |
| `media-route-worker-fullchain.tap` | 5 | 5 | 0 | 0 | Previously verified; not rerun after no app-source changes. |
| `url-validation-security.tap` | 14 | 14 | 0 | 0 | Previously verified; helper tests do not exercise publishing's raw fetch sinks. |
| `auth-campaign-billing-regressions.tap` | 56 | 56 | 0 | 0 | Offline targeted regressions; not deployed auth/account workflows. |
| `campaign-auth-static-regressions.tap` | 4 | 4 | 0 | 0 | Static route contract tests; no live account. |
| `provider-accounting-security.tap` | 106 | 104 | 2 | 0 | Failure #44 expects literal `checkBatchCompletion(batchId)` after the hold, while current worker places `markReservationForReconciliation` before `checkBatchCompletion(batchId, { ... })` at `lib/worker.ts:2117–2141, 2315–2322`; failure #47 expects two absent direct helper names in podcast/worker. Both remain unresolved static contract/source-review findings, not proof by themselves of runtime behavior. |
| `worker-pipeline-policy.tap` | 14 | 5 | 0 | 9 | Name-filtered run; 9 skipped because names did not match selected filter. |
| **Combined** | **204** | **193** | **2** | **9** | Relevant targeted subset only; not the whole repository test suite. |

`tsc --noEmit --incremental false` returned exit 0 without diagnostics. Do not count it as a test. The `test:agency-reports` suite was not run because it invokes tenant-RLS/migration scripts; `test:canary` and `test:state-machine` were not run because they load `.env.local`. The full repo suite/build/startup, live login, deployed workspace, provider, OAuth, publishing, webhook and schedule runs remain untested.

## 8. Exact remaining source-review boundaries

- The whole repository, all test source, and runtime behavior are **not** certified. The completed exhaustive scope is the tracked first-party production/runtime/build/QA-control manifest in §9, not every tracked file.
- The previous range tables in §§2–6 preserve the audit's targeted file/range history; they are no longer the exhaustive inventory. For exact reviewed files, line counts, hashes, and ranges, use §9 and `full-source-review/manifest.json`.
- Generated Drizzle snapshots/journal and `next-env.d.ts`, dependencies/lockfile metadata, docs, QA reports, fixtures and test-only sources, images/assets/screenshots, environment templates/secrets, and vendor/generated output are outside the production-source line count; §9 records why. No secret values were read.
- Source review is not runtime evidence. No credentials, signed-in deployed screen, production database, migration/RLS execution, external network/provider, receiver destination, webhook, or scheduled task was invoked in this extended pass. The public visitor-only browser evidence remains separately recorded in `live-public-audit.md`.
- Existing test totals and the two static source-contract failures are as recorded in §7 and `part-17-audit-report.md` §G. This pass did not rerun tests.

## 9. Full tracked production-source review and exact coverage

### Scope and method

The exhaustive manifest covers **736 tracked first-party production and production-operational files, 176,249 source/configuration lines, and 6,993,038 bytes** at source HEAD `3f8e15291a06d8630cea046fa924a38648f81529`. It includes every tracked source file under `app`, `client`, `components`, `hooks`, `lib`, `migrations/*.sql`, `packages/apex-receiver` implementation/config, `scripts`, `server`, `shared`, `types`, and `workers`, plus `proxy.ts` and tracked runtime/build/deployment/QA-control configuration (including `.github` workflows, `.replit`, package/build configs, Playwright config, Nginx config, PM2 configs, and `deploy.sh`). Storage implementation is in `lib/storage.ts` and the receiver package. `proxy.ts` is the middleware boundary. All **47 production SQL migration files** are included; the five generated files under `migrations/meta/` are excluded.

Each source file was read in full and SHA-256 hashed from the working-tree bytes. Files were split only at line boundaries into **182 internal `queryWithLLM` batches / 892 exact path-hash-range inputs**; each supplied line was labeled with its file-local line number. The structured answers and their ranges are retained in `full-source-review/review-batches-001.jsonl` through `review-batches-007.jsonl`; the exact manifest is `full-source-review/manifest.json`. Coverage validation matched every manifest path and hash: **736/736 files, 176,249/176,249 nonempty source lines, zero gaps, zero overlaps**. The 892 input ranges include the one tracked empty file (`package.json.tmp`, zero lines); the remaining 891 ranges contain all 176,249 source lines. All 182 batch answers returned exact requested range sets.

This is honestly **internal batch-aided line-by-line source review**, not a claim that an independent reviewer manually reread 176,249 lines. LLM summaries/findings are candidate analysis only. The batch output contained 333 candidate observations; I checked all 28 candidates labeled high/critical against the actual cited source and relevant call/cross-file paths before disposition. No additional high/critical vulnerability was confirmed from those candidates beyond the already reported F-01–F-07; unsupported or conditional candidates were not promoted to confirmed findings. Examples verified against source:

- The billing candidate describing a release/debit race is bounded by reservation-row locks and `RESERVED`→`DEBITED`/`RELEASED` compare-and-set claims in `lib/billing.ts`; the worker's `billing_pending` path records failed settlement and retries without re-entering provider generation (`lib/worker.ts:479–516, 610–647`). The static high-impact claim was not accepted as a newly confirmed free-delivery exploit.
- The video-analyzer shell-interpolation candidate was traced to `analyzeVideoStyle` call sites: the API route passes a stored reference URL with `isUrl: true`; the direct-video path obtains a local path from its download pipeline, rather than passing the caller's URL as a shell path (`app/api/social/video/like/[id]/analyze/route.ts:13–53`, `lib/video-style-analyzer.ts:535–665`). No command-execution claim was established.
- The queue-registry candidate was checked against its call sites: production calls use named queue constants or enumerated names, not request-selected arbitrary names. OAuth credential-storage candidates were checked against the app's encryption/decryption path; schema fields alone do not establish plaintext token storage.
- Callback status fall-through remains the separately confirmed F-07. Social provider code search across the full manifest found Facebook/LinkedIn/TikTok publishing calls in their adapter modules, but the central job dispatcher registers only the website adapter; OAuth endpoints are authorization/token flows, not alternative publishing dispatchers. Manual share-sheet actions remain user-operated, not server-side posting.

### Explicit exclusions

The production-source manifest deliberately does not count test-only source and fixtures (`tests/**` and package test fixtures), generated metadata/output, dependency/vendor code, lockfile resolution, documentation, QA evidence/report outputs, images/assets/screenshots, or environment/secrets files. Those categories are not production modules; several specific test suites and fixtures are separately reviewed and listed in §7, but that is not an exhaustive review of all test source. Root `scripts/` (including QA/operator controls), package build/deploy/runtime configuration, and tracked QA-control configuration were included rather than silently excluded. The exclusions do not mean those files were certified.

### Source-only receiver observations; not new reproduced findings

The independently deployable Apex receiver is under the source manifest but no live receiver was confirmed or contacted. Its media and podcast routes are HMAC-gated in `packages/apex-receiver/src/index.ts:47–49`; after that gate, media payload `sourceUrl` and podcast `audioUrl` reach `localFilesystem.downloadAndStore()` and ordinary `fetch()` without the engine's pinned safe-fetch helper, explicit timeout, or response-size limit (`packages/apex-receiver/src/routes/media.ts:12–33, 65–90`, `routes/podcasts.ts:1–50`, `storage/localFilesystem.ts:97–116`). This is a real raw-fetch sink in the receiver source, but external exploitability depends on the receiver deployment and whether untrusted tenant content can supply a URL in a valid signed request; neither was established here, so it is not presented as a reproduced SSRF finding.

The receiver page writer also uses regex filtering for a subset of dangerous HTML patterns, then interpolates some URL/structured-data fields into generated HTML (`packages/apex-receiver/src/services/page-writer.ts:14–30, 67–103, 143–165, 198–210`). HMAC authentication limits who can directly submit a payload, and this audit did not establish an attacker-controlled signed payload or exercise a deployed receiver; this remains a source-only conditional XSS review item, not a confirmed exploit. No source changes were made.

