# Citefi attachment-guided audit — Part 17 evidence report

**Audit date:** 2026-10-08 UTC  
**Source HEAD:** `3f8e15291a06d8630cea046fa924a38648f81529`  
**Overall existing certification:** **NOT CERTIFIED** (E-043–E-046 remain unchanged)  
**Application changes:** none. No application code, schema, credentials, workflow, deployment, or customer data was changed.

This is an append-only audit record for the supplied 1,911-line instruction. That instruction was reviewed in full. A subsequent internal batch-aided, line-by-line review covered **all 736 files / 176,249 source and runtime-configuration lines** in the defined tracked first-party production-source manifest. It spans authentication/MFA/recovery, RLS and migrations, billing/credits/receipts/caps, campaign identity, workers/queues/schedulers, all provider adapters, publishing/OAuth/webhooks, storage, QA gates, and the full application UI/navigation. Exact file hashes, line counts, batch ranges, answers, exclusions, and limitations are in `source-coverage.md` §9 and `full-source-review/`. This is not a whole-repository review of test-only source, generated metadata, documentation/assets, or nonproduction evidence, and it is not a runtime certification. The internal query output was treated as candidate analysis, not authoritative findings; high/critical candidates were checked against source before disposition.

## A. Executive summary

Additional parent-run deployed authorization probes are retained in
`live-anonymous-api-checks.json`: signed-out requests to `/api/auth/me`,
`/api/campaigns`, `/api/publishing/connections`, and `/api/schedules` returned
401. `/api/articles` returned 404, which is not evidence of a working article
collection API or authenticated resource isolation. Response bodies were not
retained. These five read-only HTTP probes are separate from the 204-test TAP
total and do not establish signed-in or cross-tenant behavior.

### Overall health and release recommendation

**NO-GO for production certification or expansion of live generation/publishing.** There is meaningful isolated evidence for article and media route/worker paths, but it is not a substitute for a complete integrated sandbox pipeline or real-provider/destination evidence. The four most recent genuine live Gemini article attempts each returned HTTP 200 and were durably receipted, yet **all four failed end to end**. No usable `COMPLETE` article or publication was established; the final judge made zero physical calls. The retained overall certification remains **NOT CERTIFIED**.

### What was observed or tested

- The parent agent’s separate read-only public-browser audit found `https://citefi.co/` and `/login` return 200, with title `Local SEO Content Platform for Agencies | Citefi` (see `live-public-audit.md`, which records 11 screenshots and exact captured titles/times). The separately tested `https://contentualyzai.replit.app/` had a different title, `Local SEO Content Engine for Agencies | Citefi`. These are **separate hostnames/deployment observations**; no build parity is inferred. Public visitor pages only were visited. There was no authenticated workspace or production test.
- Isolated local tests include article full-chain **5/5**, media route/worker full-chain **5/5**, URL-validation security **14/14**, authentication/campaign/billing regressions **56/56**, campaign authorization static regressions **4/4**, worker pipeline policy **5 pass / 9 filtered skips**, and provider-accounting/security **104 pass / 2 fail**. The two failures are static expectation/name drift (details in §G), not certified product defects. All suites are offline/fixture/static and no paid provider calls were made. Exact records are adjacent in this directory.
- Whole-project TypeScript checking completed with no diagnostics using `tsc --noEmit --incremental false`.
- The article fixture verified route → owned queue/worker → persisted/retrieved article, idempotency/debit behavior, shared reservation concurrency, malformed provider response/timeout non-publication, and non-replayable receipt handling.
- The media fixture verified two video routes through a worker and fixture storage, and a podcast route through its worker and fixture storage. The resulting worker videos were independently parsed by `ffprobe` as H.264 1920×1080 + AAC MP4, 11.52 seconds. A 60-second MP3 generated with the same fixture FFmpeg arguments was parsed as MP3, 44.1 kHz mono, 60.029 seconds. These are synthetic fixture media—not genuine AI video or TTS—and the podcast test did not probe bytes after retrieving them from storage.
- Test-owned PostgreSQL/Redis ports were closed after the integration tests. No application server was started or restarted.

### What remains blocked or failed

- The external provider spend ceiling previously authorized is **$30**; no new ceiling is requested or needed for this report. What remains unavailable is a named dedicated deployed test workspace/account scope, a configured in-app credit budget, and destination-specific confirmation for any public post. Authenticated production workflows, real provider/media generation, destination publication, webhooks, scheduling, live retries, and cleanup therefore remain blocked or untested.
- The previous live evidence is not to be repeated: four paid article cases failed, and no more paid calls were made in this audit.
- Source review confirms the shared safe-fetch helper is not applied to the website publishing connection ping, POST, or verification fetch; the central publishing dispatcher registers only the website adapter even though separate Facebook/LinkedIn/TikTok adapters and OAuth routes exist; social-post scheduling has a weaker PATCH path than its dedicated schedule route; and signed publishing callbacks accept `partial`/`retryable` but do not transition jobs for those values. The scheduler polls every 60 seconds; its unrelated hard-coded `0 2 * * *` UTC expression is used as the atomic claim's temporary `nextRunAt`, not as a five-minute poll. Details and source citations are in section F.
- The campaign workspace, publishing settings, social dashboard/detail, client-review UI, and all other tracked production UI source in the manifest were reviewed. They include campaign management, review actions, and manual social “Quick Share,” but no integrated one-click full-pipeline QA run/inspector was identified in the application source. This is source review only; no signed-in UI was observed or exercised.

## B. Application inventory

| Area | Identified implementation / entry points | Audit disposition |
|---|---|---|
| Public site and authentication | Public landing, login, password recovery, signup, MFA and account routes; `/api/auth/me` is the known session check | Public, signed-out pages only were observed. Anonymous `/api/auth/me` 401 is an expected boundary, not a generation result. No sign-in, MFA, recovery submission, or workspace access was attempted. |
| Campaigns, batches, local SEO articles | Campaign APIs/pages, batch APIs, title-pool API, `app/api/jobs/batch-submit/route.ts`, campaign service, article generation workers, SEO/research and article retrieval/export | Source-reviewed campaign identity from route/UI through batch, worker, caps and receipts; campaign confirm-brand, ad/export and approval paths reviewed. Article route/worker was exercised against owned DB/Redis and fake provider transport. Historical genuine provider article attempts: 4/4 failed end to end. Live content quality, factual accuracy, and full SEO publication flow are not certified. |
| Social content and social publishing | Social create/list/detail/generate/schedule APIs, `lib/social-worker.ts`, publishing APIs, three social OAuth routes/adapters and manual share UI | Generation route/worker and campaign association source-reviewed; no live social generation was run. Facebook/LinkedIn/TikTok provider adapters and OAuth flows exist in source, but are not registered in the central publisher. Social detail UI also supports manual share-sheet/copy actions; that is not server-side auto-publishing. No claim of a social-pack pass. |
| Image/hero assets | Image generation/media asset route, article asset/storage paths; prior bounded live image preflight E-045 | Media suite exercised a fixture identity/image route with synthetic transport. The separate live harness only completed preflight (maximum estimate `$0.1592`, `$0.16` reserve); it submitted no paid image request and produced no live image E2E pass. |
| Short-form/video media | `app/api/social/video/generate/route.ts`, media identity and video idea/like routes, video worker/compositor, object storage | Fixture video idea and like routes reached the worker and produced playable *synthetic* composed MP4s. Live AI media, actual production object-store configuration, user playback, and external social delivery were not tested. |
| Podcast/audio | `app/api/podcast/generate/route.ts`, podcast worker, script/TTS/merge/duration helpers, object storage | Fixture podcast route/worker and billing receipt path passed. Audio uses generated sine-wave fixture bytes, not genuine provider TTS; post-storage playback/duration was not probed. |
| QA, approval and disclosure | Article/social output safety and finalization gates; campaign approval service; client-review API/page; review/enrichment API | Gate implementations and review flows source-reviewed. Campaign approval enforces designated reviewer roles and tenant ownership in the reviewed service; article client review is exposed in UI. Live final judge was not called; article integration tests inject review dependencies. No integrated QA inspector/full-pipeline runner was identified in the inspected UI. |
| Publishing and callbacks | Connection/job APIs; central dispatcher; website/Facebook/LinkedIn/TikTok adapters; OAuth state/credential services and routes; signed receiver callback; Stripe billing webhook | Dispatcher is website-only; three social adapter modules/OAuth flows do exist but are disconnected from dispatch. Website ping/POST/verify are not using shared safe-fetch controls. No receiver/destination or live webhook was tested. |
| Scheduling and recovery | Schedule API, scheduled-content worker, queue/worker lifecycle and auxiliary pollers | Source review distinguishes 60-second content-schedule polling from a separate 5-minute spend-breaker poll. The literal daily 02:00 UTC cron is the atomic claim's temporary `nextRunAt`; configured cron is used at initialization and completion/failure. No schedule was created or executed. |
| Billing, plans and cost controls | Two-bucket credit reserve/debit/release/grant engine, usage caps/settlement, provider attempt receipts, provider-usage ledger, Stripe reconciliation/webhook, paywall and campaign billing | Core accounting and ownership code was source-reviewed; offline security/billing/campaign/worker tests were expanded. No live entitlement, payment, provider-cost, or customer-ledger action occurred. Existing cost audit remains authoritative; these tests do not certify live accounting. |
| Agency, client workspaces, reports, learning, journeys, analytics, admin and integrations | Present in app/API inventory (256 API route files) | All tracked production source in these feature areas is covered by the line-by-line batch-aided manifest. Routes/features were not exercised as authenticated deployed workflows; the targeted tests do not certify their runtime behavior. |

### Provider/credential boundary

Source references Gemini, OpenAI, Google media, TTS, video generation, DigitalOcean Spaces, and website receiver interfaces, as well as Facebook/LinkedIn/TikTok connection values. This is source-level capability only. No secret values, OAuth tokens, `.env.local`, live connection credentials, or connected-account inventory were read. No configured credential or working integration is asserted.

### Requested control surfaces

The campaign workspace, campaign Ads Lab, publishing settings and job navigation, social dashboard/detail/create flow, client-review queue, and all other tracked production UI source in the manifest were reviewed line by line in internal batches. These show campaign/content controls, approvals, retry/schedule/edit/delete controls, and manual Quick Share; they do not provide an integrated Strict Live/Sandbox end-to-end campaign runner, QA inspector, live terminal/webhook inspector, or cleanup evidence export. The repository still has no `test:e2e` package script. This is a source/UI finding, not a live UI certification: public-browser evidence confirms no signed-in dashboard was inspected.

## C. End-to-end flow maps and coverage boundaries

1. **Blog/article:** authenticated batch-submit → validate/claim and idempotency → credit/cap reservation → durable queue → worker/provider call → normalize/validate/render and persist checkpoints → final structural, claim-review and brand-policy gate → `COMPLETE` → optional media/exports/auto-publish. The isolated article test reaches the queue/worker and retrieval using injected provider transport and test dependencies. Its speed-mode fixture disables paid review/enhancement; it does **not** prove live Gemini output or a complete production AI/QA path.
2. **Social pack:** authenticated social-post route → team-scoped article/campaign resolution → cap/credit/queue → social worker → platform formatting/finalization → persist. This chain was source-reviewed but not executed. Separate social publishing is not demonstrated by generated copy: platform adapter/OAuth implementations exist for Facebook, LinkedIn, and TikTok, while the central publisher has only the website adapter. Social detail “Quick Share” opens/manual-copies content into platform share surfaces; it does not post automatically.
3. **Video:** authenticated generation route → storage preflight/paywall/limits/cap/credits/concurrency slot → job queue → video worker/provider media → FFmpeg compositor/audio mix → storage and debit. Owned fixture tests covered idea and like-video queue/worker paths. `ffprobe` confirms the retained synthetic worker videos contain H.264/AAC streams. No live provider or production object-store test occurred.
4. **Podcast:** authenticated article ownership/status lock → cap/credit reservation → queue → script generation/brand check → orchestration and TTS/merge → duration/storage → debit/settlement. Fixture route → worker → persisted ready URL/receipt/debit passed. No genuine TTS/provider output was used.
5. **QA/approval:** article worker validates structure/word bounds/URLs before finalization, then calls the article finalization gate before `COMPLETE`; social finalization normalizes caption/hashtags, checks URLs, and invokes review/policy. These are code-path observations. Fixture dependencies and prior live evidence do not establish real judge accuracy, media QA, manual approval UI, false-negative rate, or complete QA reporting.
6. **Publishing:** connection/job endpoint → durable DB job and queue → `getAdapter(channel)` → validate/format → signed website receiver request → job status/callback. Only website is registered in the central adapter map. Separate Facebook/LinkedIn/TikTok adapters, OAuth authorization/callback routes, and credential-refresh code exist but are not imported into the dispatcher. No authorized receiver or destination was accessed.
7. **Scheduling:** schedule API → due-run worker claims schedule → research/title pool → cap/credit reservation → batch plus generation queue → eventual optional publication. No authorized schedule execution occurred. Claim recovery/timing is a release concern below.

Across all flows, scheduled execution, publication verification, attribution/analytics, customer workspace separation at broad product scope, and destination cleanup remain unverified. The offline billing and worker regressions described in §G add focused code-path evidence only; they do not certify external behavior.

## D. Required 14-case test matrix

Statuses describe only the test outcome and scope shown; a neighboring unit/fixture test is never promoted into an unrun integrated/live pass.

| ID | Area and required scenario | Actual result / mode | Status | Evidence |
|---|---|---|---|---|
| 1 | Full pipeline sandbox: blog → social → video → podcast → QA → mock publish → report | Separate article and media fixture chains passed; this exact cross-modal pipeline, QA dashboard, mock publishing, and report export were not run. | NOT TESTED | `article-full-chain.tap`, `media-route-worker-fullchain.tap` |
| 2 | QA interception: banned wording, invalid URL/schema, wrong brand; verify specific blocking | Article malformed provider response and timeout did not publish; standalone URL rejection/pinning suite passed. The complete requested set of interception injections/metrics was not run. | NOT TESTED | Article TAP; `url-validation-security.tap` |
| 3 | Real AI generation: actual request/output/status/persistence/cost | Prior authorized live evidence documents four actual Gemini 3.5 Flash submissions, each HTTP 200, but all four cases failed: token truncation; Guardian rejection/zero rendered links; output 1,556 words vs max 1,400; token truncation. No live call in this audit. | LIVE FAILED | `QA/evidence/live-current/live-qa-summary.md` §§3–24; E-043 |
| 4 | Live media: real video and podcast, playable/metadata | No live video/TTS/audio calls were made; only synthetic local files were parsed/tested. | BLOCKED | `live-qa-summary.md` §§63–73; media TAP; `ffprobe` measurements in this report |
| 5 | Live webhook delivery | No authorized target, real payload or delivery was attempted. | BLOCKED | No destination authorization/configuration supplied |
| 6 | Live publishing to every authorized destination and destination-side verification | No authorized connection/account/destination was supplied; none was accessed. | BLOCKED | Read-only public browser boundary; publishing adapter source review |
| 7 | Scheduled auto-post | No schedule or post was created. | BLOCKED | No authorized schedule/window/destination |
| 8 | Duplicate prevention | Duplicate article batch submission with the same request key resulted in one submission and one charge; no duplicate publishing delivery was exercised. | SANDBOX PASSED | Article TAP test 2; article-submit scope only |
| 9 | Partial failure across destinations with isolated retry | No multi-destination publish test was performed. | NOT TESTED | No authorized destination |
| 10 | Persistence and recovery: refresh/restart worker and recover | Fixture route/worker state was persisted and retrieved; different synthetic tenant was denied. No UI refresh or worker restart/recovery test was performed here. | NOT TESTED | Article and media TAPs |
| 11 | Credits and plan gating: ledger, insufficient balance, server entitlement | Article/media fixtures asserted selected reservation/debit/accounting behavior. No plan/paywall matrix, real balance, insufficient-credit route, or live subscription was tested. | NOT TESTED | Article and media TAPs; `live-qa-summary.md` |
| 12 | Workspace isolation between synthetic clients | Article retrieval was team-scoped; media object retrieval/wrong-tenant route checks deny another synthetic tenant. This is only tested endpoint coverage, not every API/RLS boundary. | SANDBOX PASSED | Article and media TAPs; tested endpoints only |
| 13 | Safe security/authorization regressions | URL-helper tests passed 14/14 using stubbed DNS/HTTP(S). Auth/campaign/billing offline regressions passed 56/56 and campaign-auth static regressions passed 4/4. Website connection ping, publication POST and verification HEAD remain separate raw-fetch sinks outside that URL-helper suite. | PARTIAL SANDBOX PASS | `url-validation-security.tap`, `auth-campaign-billing-regressions.tap`, `campaign-auth-static-regressions.tap`; F-01 |
| 14 | Full existing and relevant regression suite | Focused offline article/media, URL, auth/campaign/billing, campaign ownership, provider-accounting/security and worker-policy tests plus typecheck were recorded. Combined: 204 tests, 193 pass, 2 fail, 9 filtered skips. This is not the entire repository suite. | PARTIAL; FULL SUITE NOT TESTED | TAPs in this directory; per-suite breakdown in §G and `source-coverage.md` |

## E. Generation and publishing coverage

| Workflow | Live status | Sandbox status | Evidence | Remaining blocker |
|---|---|---|---|---|
| Blog generation | LIVE FAILED (four historical attempts; none in this audit) | SANDBOX PASSED for owned route/worker fixture; fake provider | Article TAP; E-043 live case summary | Real provider output must fit requested bounds and pass the actual review gate; retest still awaits the dedicated deployed workspace/account scope and configured in-app budget. The external $30 ceiling is already authorized. |
| Blog QA and persistence | BLOCKED for live QA | SANDBOX PASSED for retrieval/team scope and malformed-response non-publication; reviewer injected | Article TAP; finalization gate source | No physical final judge call; no live completed artifact |
| Social generation | BLOCKED / NOT TESTED | NOT TESTED in this audit | Source-reviewed route, social worker and campaign identity | No dedicated deployed account scope, generation run, configured in-app budget, or QA/persistence result |
| Image/hero generation | BLOCKED live | SANDBOX PASSED for fixture image route only; live E-045 was preflight, no request | Media TAP; `QA/evidence/live-current/live-qa-summary.md` E-045 | No paid live image submission, output persistence or E2E pass |
| Video generation and playback | BLOCKED live | SANDBOX PASSED for fixture route/worker and playable synthetic MP4 | Media TAP; `/tmp/veo-output/815/with-audio.mp4` and `/tmp/veo-output/816/with-audio.mp4` parsed by `ffprobe` | No real video provider run, public retrieval/playback, or external post |
| Podcast generation and playback | BLOCKED live | SANDBOX PASSED for fixture route/worker persistence/debit; synthetic MP3 fixture parses | Media TAP; `fixture.mp3` `ffprobe` result below | No real script/TTS result and no post-storage byte/duration probe |
| QA and approval | BLOCKED live | PARTIAL fixture gates only | `article-full-chain.tap`; gate source | No live judge; no full QA interceptions, media QA, or approval UI |
| Website/CMS publishing | BLOCKED live | NOT TESTED | Website adapter/publishing source | No authorized receiver test. SSRF and metadata/runtime compatibility review required. |
| Facebook publishing | BLOCKED | NOT TESTED | Facebook adapter and OAuth routes exist; central dispatcher is website-only | Adapter is not connected to dispatch; no destination test. |
| LinkedIn publishing | BLOCKED | NOT TESTED | LinkedIn adapter and OAuth routes exist; central dispatcher is website-only | Adapter is not connected to dispatch; no destination test. |
| X/Twitter publishing | BLOCKED | NOT TESTED | Social platform normalizer/source inventory | No publishing adapter registered or destination test. |
| TikTok publishing | BLOCKED | NOT TESTED | TikTok adapter and OAuth routes exist; central dispatcher is website-only | Adapter is not connected to dispatch; no destination test. |
| YouTube publishing | BLOCKED | NOT TESTED | No registered connection/adapter identified | No authorized destination or implementation demonstrated. |
| Webhook delivery | BLOCKED | NOT TESTED | Route/provider inventory only | No authorized webhook destination/test. |
| Scheduled auto-posting | BLOCKED | NOT TESTED | Schedule source review | No actual due-run execution; the claim's temporary fixed cron should use persisted configuration. Worker polling is 60 seconds (not a five-minute cron). |
| Duplicate prevention | BLOCKED for publication | SANDBOX PASSED for article idempotent submission only | Article TAP test 2 | No duplicate publish/re-delivery test |
| Credits and subscriptions | BLOCKED live | PARTIAL route/worker reservation/debit behavior | Article/media TAPs; live cost ledger | No entitlements/insufficient balance/real ledger test; historical calls unreconciled |
| Workspace isolation | BLOCKED for broad live scope | SANDBOX PASSED for synthetic article/media endpoint checks | Article and media TAPs | Not a whole-API/RLS/customer-workspace certification |
| Security | BLOCKED for live-auth scope | SANDBOX PASSED (URL helper tests only; F-01 call sites remain open) | URL TAP; source review | Fix/test all outbound sinks; authorized security test account absent |

`ffprobe` observations: the two retained worker outputs are H.264 video, 1920×1080, AAC audio, 11.520 seconds, MP4 container, 132,606 bytes. The retained podcast fixture produced by the suite’s FFmpeg fixture recipe is MPEG audio, 44.1 kHz mono, 60.029388 seconds, 240,345 bytes. It is a sine-wave fixture, not a generated podcast.

## F. Defect report

Severity: **P1/high** means security or release-blocking production risk; **P2/medium** means material reliability/acceptance issue. These are source findings, not claims that an exploit or live schedule was executed.

### F-01 — Website connection, publish, and verification fetches permit SSRF

- **Severity:** P1 / high security risk.
- **Location:** `lib/publishing/index.ts:179–240` (`testConnection`); `lib/publishing/channels/website/adapter.ts:455–533` (`publish`) and `640–659` (`verify`); `app/api/publishing/connections/route.ts:9–13, 41–69`; `app/api/publishing/connections/[id]/test/route.ts:5–20`.
- **Finding:** An authenticated team can create a website connection with a syntactically valid caller-supplied `baseUrl`. The test route takes the origin and performs ordinary `fetch()` to `/api/v1/status/ping`; the website adapter constructs its receiver POST from that connection and also follows its returned `publishedUrl` with an ordinary `HEAD` verification fetch. None of these three outbound website call sites applies the repository's shared safe-fetch controls (public-address filtering, pinned DNS, redirect revalidation, timeout/response bounds). The separate URL helper is exercised by 14 passing mocked tests, but those tests do not cover these publisher sinks.
- **Impact:** A user with a team account may induce server-side requests to internal/metadata endpoints or attacker-controlled redirect/verification targets. These calls can expose internal services or consume worker resources.
- **Reproduction (not performed):** Create a website connection to a private/internal URL and invoke that connection’s test endpoint; the route calls the destination from the server. No live or private endpoint was contacted for this audit.
- **Recommendation:** Validate and resolve the receiver URL using the established pinned public-address transport for ping, publish, and verification; deny private/reserved addresses and unsafe schemes/ports; revalidate every redirect or disable redirects; add strict timeout/body limits. Add regressions at all three publishing call sites, not only at the helper.
- **Fix approved/applied:** No. Application was frozen read-only.

### F-02 — Social adapters/OAuth exist but are disconnected from central publishing dispatch

- **Severity:** P1 / high for advertised social auto-publishing; otherwise P2 / medium if those connection values are intentionally placeholders.
- **Location:** `lib/publishing/index.ts:13, 24–26, 92–94, 438–442`; connection schema `app/api/publishing/connections/route.ts:9–13`; channel settings UI `app/settings/publishing/page.tsx:84–87, 862`; source adapters `lib/publishing/channels/facebook/adapter.ts:1–199`, `linkedin/adapter.ts:1–204`, `tiktok/adapter.ts:1–210`; OAuth service/routes listed in `source-coverage.md`.
- **Finding:** Facebook, LinkedIn and TikTok provider adapter implementations and OAuth authorize/callback/credential-refresh flows exist. However, the central `lib/publishing/index.ts` imports/registers only the website adapter, and job processing resolves only that registry; a queued job for any social channel therefore gets `UNSUPPORTED_CHANNEL`. The connection API schema accepts all four values, but the publishing settings UI marks Facebook, LinkedIn and TikTok disabled/“Soon”. The completed production-source review also searched for direct provider-post calls outside the central registry: actual social `publish()` calls are in those adapter modules, while the OAuth routes handle grants/tokens, not an alternate post dispatcher. Separately, social detail UI offers manual copy/share-sheet links (e.g. LinkedIn share-offsite), which require user action and are not this server-side publishing path. This is a wiring/availability gap, not an absence of social adapter source.
- **Impact:** If a social connection/job is created through an API or other path, the central publisher cannot dispatch it. The settings UI's disabled channels reduce visible exposure but do not make the accepted API values publishable; manual share UI must not be represented as automatic publishing.
- **Recommendation:** Wire and destination-test supported adapters through the central dispatcher, or block those connection/job options until the integrated publisher is supported. Keep manual share clearly distinguished.
- **Fix approved/applied:** No.

### F-03 — Live article quality/output gate has no end-to-end success

- **Severity:** P1 / release blocker.
- **Location:** Retained E-043: `QA/evidence/live-current/live-qa-summary.md:9–24`.
- **Finding:** Four paid Gemini requests returned HTTP 200, but each requested article was unusable: one hit `MAX_TOKENS`; one was rejected by Guardian due to zero links and never reached the final judge; one exceeded the requested max (1,556 vs 1,400 words); one hit `MAX_TOKENS`. Each end-to-end case failed; there is no usable `COMPLETE` artifact or publication. Retrieval 200 and other-tenant 404 prove only those access outcomes.
- **Impact:** Successful HTTP/provider status is not product success; the real generation promise is not certified.
- **Recommendation:** Continue the retained NOT CERTIFIED state. Reconcile historical calls, inspect token/thinking and word-bound controls, and require the actual production judge and a bounded successful end-to-end artifact. The historical external spend ceiling is already authorized at $30; do not request a second ceiling. Live use still requires the missing named deployed test workspace/account scope, a configured in-app credit budget, and destination-specific public-post confirmation.
- **Fix approved/applied:** FAQ assembly/token-accounting fixes and their offline regressions are recorded in E-044, but they do not turn any of the four live cases into a pass. No new fix was applied here.

### F-04 — Schedule claim uses a fixed cron expression

- **Severity:** P2 / medium reliability.
- **Location:** `lib/scheduled-content-worker.ts:12–25, 28–51, 204–251`.
- **Finding:** `SCHEDULE_CHECK_INTERVAL` is 60,000 ms, and `initializeScheduler()` polls due rows every 60 seconds (`lib/scheduled-content-worker.ts:10, 284–315`). A separate spend-breaker timer has a five-minute poll; that is not the schedule cadence. In `executeScheduledRun()`, the atomic due-row claim temporarily writes `nextRunAt` from the literal `"0 2 * * *"` / `"UTC"` (`:28–51`) instead of that row's configured cron/timezone. Normal completion/failure recalculates from configured values (`:204–251`); a process failure after claim leaves the temporary value persisted. Invalid cron parsing also logs and substitutes +24h.
- **Impact:** A crash during a scheduled run can move a due retry to an unrelated 02:00 UTC time. Invalid configuration may be accepted and silently run at an unexpected cadence. The source does **not** establish a five-minute schedule poll.
- **Recommendation:** Use a separate atomic claim/lease field or compute the claim’s next run from the persisted cron and timezone. Validate cron/timezone before accepting the schedule; fail visibly rather than silently substituting 24h.
- **Fix approved/applied:** No.

### F-05 — Requested integrated full-pipeline QA runner is not present in reviewed control surfaces

- **Severity:** P2 / medium verification gap.
- **Location:** `package.json` scripts; line-by-line `app/campaigns/**`, `app/settings/publishing/**`, `app/social/dashboard/page.tsx`, `app/social/create/page.tsx`, `app/social/[id]/page.tsx`, and `app/client/review/page.tsx` ranges recorded in `source-coverage.md`.
- **Finding:** Those reviewed surfaces provide campaign actions, manual approval, publishing connection/job controls, and social create/edit/schedule/delete/manual-share actions. They do not expose the specified single run-all live/sandbox test campaign, QA inspector, live terminal/webhook inspector, or cleanup evidence export; `package.json` also has no `test:e2e` script. This is now based on source review of named screens plus script inspection, not a whole-repository UI-absence claim.
- **Impact:** Operators cannot rely on the requested observable mode distinction, evidence/export dashboard, or safe single-click end-to-end test from the reviewed controls.
- **Recommendation:** Either implement the required bounded, tenant-isolated QA runner with explicit mode/budget/destination gates and evidence export, or document supported testing controls and label unavailable features accurately.
- **Fix approved/applied:** No.

### F-06 — Social-post detail scheduling bypasses the dedicated route's future/status guards

- **Severity:** P2 / medium reliability.
- **Location:** `app/api/social_posts/[id]/route.ts:28–30, 164–218`; comparison route `app/api/social_posts/schedule/route.ts:1–102`; caller UI `app/social/[id]/page.tsx:570–582, 1490–1533`.
- **Finding:** The detail UI calls `PATCH /api/social_posts/:id`. That handler validates only that `scheduleAt` is an ISO datetime, team-scopes the read, then writes `status: "SCHEDULED"` without checking that the requested time is future or that the current post is not terminal. The distinct `/api/social_posts/schedule` handler performs future-time and terminal-state checks. Thus the visible Schedule control bypasses those stricter checks and can schedule a past time or overwrite a posted/deleted status.
- **Impact:** Users can receive a success response for a schedule that is already due/past or mutate a terminal post back to scheduled, creating inconsistent state for the scheduler.
- **Recommendation:** Route both UI and API callers through one shared scheduling validator/transaction that rechecks future time and allowed state in the update predicate.
- **Fix approved/applied:** No.

### F-07 — Signed publishing callback acknowledges `partial`/`retryable` without transitioning the job

- **Severity:** P2 / medium publishing reliability.
- **Location:** `app/api/publishing/callbacks/route.ts:10–19, 145–182`; callback status storage `shared/schema.ts:2492–2520`.
- **Finding:** Callback validation accepts `success`, `failure`, `partial`, and `retryable`. After signature validation and callback-row insertion, job-state updates exist only for `success` and `failure`; `partial` and `retryable` fall through to a success response while leaving the publishing job's status/attempts/retry time unchanged. The callback table has ordinary indexes but no callback idempotency key/unique constraint.
- **Impact:** A receiver may be told that an acknowledged partial/retryable callback was processed while the central job remains in its previous state, leaving the job stuck or un-retried. No callback was sent during this audit.
- **Recommendation:** Define and implement state transitions for every accepted status (or reject unsupported statuses), and add a durable callback idempotency identity before acknowledging/replaying status-changing events.
- **Fix approved/applied:** No.

### Retained operational / cost blockers

- E-042 records recurrent Neon/HTTP and journey-scheduler issues and a development Redis refusal, with workers enabled in that observed configuration. That remains a known runtime gap; this audit did not restart a worker-enabled app.
- The retained final cost ledger reports `$0.474870` of conservative estimated usage for the four latest paid article calls, not an invoice; `$0.517071` is prior known valuation, also not an invoice; the separate `$6` historical coverage HOLD is not spend/approval; two older physical calls remain `UNKNOWN / UNRECONCILED`. Latest recorded availability within the already-authorized `$30` ceiling was `$23.008059`. This audit added **$0** in provider usage and did not run another paid test or request further spend authorization.

## G. Performance, offline regression execution and accounting

### Additional offline regression runs

| Suite/evidence | Actual TAP result | Scope and limitation |
|---|---:|---|
| `article-full-chain.tap` | 5 tests: 5 pass, 0 fail/skip | Owned route/worker fixture; no real provider. Previously verified; not rerun after source review. |
| `media-route-worker-fullchain.tap` | 5 tests: 5 pass, 0 fail/skip | Owned media route/worker fixture, synthetic provider outputs/storage. Previously verified; not rerun after source review. |
| `url-validation-security.tap` | 14 tests: 14 pass, 0 fail/skip | Mocked DNS/HTTP(S) safe-fetch helper regressions; does not cover website publishing fetch sinks. Previously verified; not rerun. |
| `auth-campaign-billing-regressions.tap` | 56 tests: 56 pass, 0 fail/skip | Focused offline regression bundle covering CSRF/recovery, campaign confirm/ownership, batch/credit settlement and related route contracts; not a live auth or account workflow. |
| `campaign-auth-static-regressions.tap` | 4 tests: 4 pass, 0 fail/skip | Static campaign authorization/confirm-brand behavior, including tenant and incomplete-research cases; no deployed account. |
| `provider-accounting-security.tap` | 106 tests: 104 pass, 2 fail, 0 skip | Receipt/ledger/accounting/security contracts. Failure #44 is a static source-pattern assertion: it expects the exact text `checkBatchCompletion(batchId)` after the billing hold, while current `lib/worker.ts:2117–2141, 2315–2322` places `markReservationForReconciliation` before `checkBatchCompletion(batchId, { ... })`. Failure #47 expects direct named helper calls absent from the current podcast/worker source. Both failures remain unresolved test-contract/source-review findings; neither alone proves a runtime accounting failure. |
| `worker-pipeline-policy.tap` | 14 tests: 5 pass, 0 fail, 9 skipped | Name-filtered worker policy/retry/release/circuit suite. Nine skips are deliberate name-filter skips; this is not a full lifecycle suite. |
| Combined recorded TAP executions | 204 tests: 193 pass, 2 fail, 9 filtered skips | Sum of the suites above. This is the audit's relevant offline subset, not the repository's full test suite. |
| TypeScript | `tsc --noEmit --incremental false`: exit 0 | No diagnostics; not a behavioral test. |

No live provider, Stripe, OAuth, public post, customer workspace, or production ledger action was made during these runs. Existing article/media/URL runs were not repeated because no application source changed.

| Work | Measured wall time | Result | Cost meaning |
|---|---:|---|---|
| Article route/worker full-chain fixture | 47,049.364 ms TAP duration | 5/5, no skips | Fake provider transport; no provider spend |
| Media route/worker full-chain fixture | 27,122.530 ms TAP duration | 5/5, no skips | Injected providers and fixture storage; no provider spend |
| URL-validation security regression | 604.230 ms TAP duration (saved TAP); first console run 1,355.508 ms | 14/14, no skips | DNS/HTTP transport mocked; no internet provider spend |
| Auth/campaign/billing regression bundle | 16,443.280 ms TAP duration | 56/56, no skips | Offline regression boundary |
| Campaign authorization static regression | 898.824 ms TAP duration | 4/4, no skips | Static contract; no deployment |
| Provider-accounting/security contracts | 77,868.267 ms TAP duration | 104/106; 2 static contract failures | See §G exact failure reasons; no provider spend |
| Worker pipeline policy subset | 856.090 ms TAP duration | 5/14; 9 name-filtered skips | Filtered policy cases only |
| TypeScript check | No timing recorded | `tsc --noEmit --incremental false` exited 0, no diagnostics | No provider spend |

No per-stage live latency, actual external provider retry rate, live batch throughput, production storage latency, publication success count, or measured live cost per article/video/podcast was collected here. No real provider request was sent in this audit. The prior four live article requests and their measured usage estimates are stated in E-043 and are not combined with local test cases. Their `$0.474870` is a conservative estimate, not an invoice. E-045's `$0.1592` image maximum estimate / `$0.16` reserve was a preflight only, not spend. No batch-performance or 10×/100× load result is claimed.

## H. Fact-check and QA report

- No new topical claims were generated for factual review. The fake article test validates plumbing/structural behavior, not factual accuracy.
- The finalization gate source combines deterministic article structural/output checks with claim-review and brand-policy checks. This audit did not make a paid final-judge call. The article route/worker fixture injects review/test seams, and the production speed-mode path records that GPT review/enhancement may be disabled; fixture success does not establish live judge execution or factual correctness.
- Historical live evidence has one Guardian call and **zero final-judge physical calls**. One case was rejected by Guardian due to zero links; that is not evidence of all metrics or fact claims passing.
- No E-E-A-T, source grounding, originality, plagiarism, SEO ranking, brand accuracy, media quality, caption safety, or platform-compliance score was newly measured. No false-positive/false-negative rate can be reported.

## I. Security report

- **Authorization:** Public browser journey only; no credentials were entered. Source review covered auth/session/MFA/password-recovery/reset/signup/logout/team-context helpers and routes plus campaign/review/publishing/social team predicates. Login is rate-limited at 10 attempts per IP per 15 minutes (`app/api/auth/login/route.ts:17–24`); MFA verify at 5 per IP and 5 per user per 15 minutes plus a 5-attempt challenge ceiling (`verify-2fa/route.ts:29–64, 50–52`); reset, email-code, signup, and TOTP endpoints have distinct DB-backed limits listed in `source-coverage.md`. These are source observations, not a live brute-force test. Parent evidence includes anonymous `/api/auth/me` 401; prior E-043 article retrieval returned 200 to its test tenant and 404 to a different authenticated tenant, which is narrow endpoint evidence, not universal isolation.
- **Tenant isolation:** Current article/media fixtures assert synthetic team scoping/denial at tested endpoints. They do not verify every route, worker, RLS policy, client role, agency boundary, or provider reconciliation path.
- **SSRF/network:** Safe-fetch helper tests passed 14/14 with DNS and HTTP/HTTPS transport stubs, covering private/mapped IPs, DNS rebinding, redirects, timeouts, and size limits. Source confirms that website connection ping, publication POST and returned-URL HEAD verification bypass that helper (F-01). No target was contacted.
- **Credentials:** No secrets were read or placed in the report. Tests were launched with a clean environment; live provider credentials were absent/unused. No OAuth secret or API key value was accessed.
- **Webhooks/OAuth/payment:** Source-reviewed Stripe billing webhook signature/idempotency/credit reversal flow, publishing callback HMAC/timestamp validation, and Facebook/LinkedIn/TikTok OAuth state/tenant flows. No live webhook, OAuth grant, connected account, destination delivery, payment event, or email was exercised. Callback status handling gap is F-07.
- **Additional receiver boundaries (source-only; not reproduced):** The standalone Apex receiver routes are HMAC-gated (`packages/apex-receiver/src/index.ts:47–49`), but authenticated media/podcast payload URLs reach ordinary `fetch()` in `storage/localFilesystem.ts:97–119` without the engine safe-fetch helper, explicit timeout, or response-size cap. The receiver's page writer removes selected patterns with regex and interpolates several URL/JSON-LD fields into page HTML (`services/page-writer.ts:14–30, 67–103, 143–165, 198–210`). These are confirmed source sinks, but an attacker-controlled signed payload and deployed receiver scope were not established; they remain conditional SSRF/XSS verification items, not reproduced findings.
- **Migrations/RLS:** No production/customer migration or database maintenance command was run. No workflow script with `.env.local` or migration side effects was executed.
- **Outstanding security concerns:** F-01 outbound SSRF sinks; F-07 callback state handling; untested cross-route authorization/RLS beyond the exact reviewed ranges; no dedicated deployed authenticated test environment.

## J. Cleanup inventory

### Live/external artifacts

**None created by this audit.** There is no publication ID/URL, external post, live schedule, customer workspace write, uploaded production object, email, OAuth grant, or live database row from this audit. Parent’s browser audit was read-only. No deletion, unpublish, rollback, or remote cleanup was performed.

Pre-existing E-043 live article case artifacts under `QA/evidence/live-current/` belong to the previous authorized run and were not created or altered by this audit. They remain subject to the existing cleanup owner’s approval process; no destination publication was recorded in the cited summary.

### Local audit artifacts

| Artifact | Workspace/destination | Created by | Disposition / suggested cleanup |
|---|---|---|---|
| `QA/evidence/attachment-audit/article-full-chain.tap` | Repository evidence directory; owned local test DB/Redis and filesystem fixtures | Article suite | TAP retained. Test-owned DB/Redis ports 55490/16390 and HTTP 5110 were confirmed closed. |
| `QA/evidence/attachment-audit/media-route-worker-fullchain.tap` | Repository evidence directory; owned local DB/Redis/filesystem fixtures | Media suite | TAP retained. Test-owned DB/Redis ports 55488/16388 were confirmed closed. |
| `QA/evidence/attachment-audit/url-validation-security.tap` | Repository evidence directory; mocked transport | Security tests | TAP retained; no external connection. |
| `QA/evidence/attachment-audit/auth-campaign-billing-regressions.tap`, `campaign-auth-static-regressions.tap`, `provider-accounting-security.tap`, `worker-pipeline-policy.tap` | Repository evidence directory; offline regression commands | Auth/billing/campaign/provider/worker suites | TAP retained; counts and the two unresolved static contract failures are listed in §G. |
| `/tmp/veo-output/815/with-audio.mp4`, `/tmp/veo-output/815/stitched.mp4`, `/tmp/veo-output/816/with-audio.mp4`, `/tmp/veo-output/816/stitched.mp4` | Local filesystem only | Media fixture video worker | Retained, not uploaded/published; no cleanup performed. The `with-audio.mp4` outputs were probed and are readable MP4s. |
| `/tmp/citefi-attachment-audit-fUaMMw/fixture.mp3` | Local filesystem only | Reproduction of the test’s FFmpeg fixture recipe | Retained, not uploaded/published; no cleanup performed. Valid synthetic MP3. |

The integration fixtures’ temporary PostgreSQL/Redis/object-storage resources were disposed by their own teardown. No residual test ports remained. If local media files should be removed, request approval; none were removed automatically.

## K. Release readiness

| Capability | Verdict | Basis |
|---|---|---|
| Blog generation | **NO-GO** | Four live end-to-end failures; no usable live COMPLETE artifact |
| Social generation | **NO-GO** | No authenticated end-to-end test in this audit; no live result |
| Video generation | **NO-GO** for live release | Synthetic route/worker fixture passes; no real provider or destination-side playback/publication |
| Podcast generation | **NO-GO** for live release | Synthetic fixture pipeline passes; no real TTS or post-storage audio verification |
| QA and approval | **NO-GO** | No live final judge or full QA/interception/approval UI certification |
| Auto-publishing | **NO-GO** | No authorized destination; adapter availability gap; SSRF finding |
| Website receiver | **NO-GO** | No receiver verification; outbound connection-test SSRF issue |
| Scheduling and retries | **NO-GO** | No live run/recovery test; fixed claim cron finding |
| Multi-client isolation | **NO-GO** for broad certification | Narrow synthetic/live endpoint checks pass; no all-route/role/RLS certification |
| Overall platform | **NO-GO — NOT CERTIFIED** | E-043–E-046 remain not certified; live article failures, security gap, and no authorized workspace/destinations |

### Five highest-priority blockers

1. **No successful real article workflow:** Four genuine requests ended in unusable/truncated/over-limit/Guardian-rejected output; no usable live artifact or final judge pass.
2. **SSRF in website connection test:** Route caller-controlled receiver `baseUrl` through ordinary server-side `fetch`; add pinned public-only transport and route-level security regression.
3. **Unimplemented publishing dispatch for accepted social channels:** Register real adapters or reject unavailable channels before connection/job creation.
4. **Schedule timing/recovery correctness:** Stop claiming due schedules with an unrelated hard-coded cron; validate and persist the configured cadence.
5. **No scoped end-to-end production verification:** A named dedicated deployed test workspace/account scope, configured in-app credit budget, and destination-specific public-post confirmation are missing; the external `$30` spend ceiling is already authorized. Existing runtime readiness/cost-accounting blockers must be resolved without restarting worker-enabled production unsafely.

## L. Extended full production-source review

- **Exact covered scope:** 736 tracked first-party production/runtime/build/QA-control files; 176,249 source/configuration lines; 6,993,038 bytes; source HEAD `3f8e15291a06d8630cea046fa924a38648f81529`. Hash/range inventory: `full-source-review/manifest.json`.
- **Coverage result:** 182 internal `queryWithLLM` batches and 892 path/hash/range inputs (including one empty tracked file); every manifest path and hash is represented, every answer returned the exact requested ranges, and the merged coverage has **zero gaps and zero overlaps**. The 891 nonempty ranges cover exactly 176,249 lines.
- **Review method:** Each file was read in full, SHA-256 hashed, and chunked on line boundaries with exact file-local line labels. The internal batch outputs are preserved in `review-batches-001.jsonl` through `review-batches-007.jsonl`. This is accurately described as **internal batch-aided line-by-line review**, not an independent manual reread or runtime certification.
- **Candidate adjudication:** Batch answers returned 333 candidate observations, including 28 tagged high/critical. Each high/critical candidate was checked against the cited source and relevant caller/cross-file path; no additional high/critical issue was confirmed beyond F-01–F-07. Conditional Apex receiver raw-fetch/HTML-generation boundaries and the exact conditions still unverified are disclosed in `source-coverage.md` §9 and §I, rather than promoted to reproduced findings.
- **Explicitly outside this production-source count:** Test-only sources/fixtures, generated metadata/output, dependency/vendor code and lockfile resolution, docs/README, QA evidence, images/assets/screenshots, and environment/secrets files. Earlier targeted test runs remain as recorded in §G; no tests were rerun during this source extension.
- **Safety/accounting:** No application source was changed; no provider or external API call was made; no paid call, network probe, database/migration operation, schedule, webhook, destination post, or workflow was executed. External spend ceiling remains the already-authorized `$30`; outstanding production scope is the named dedicated deployed test workspace/account, configured in-app credit budget, and destination-specific public-post confirmation.

## Evidence files

- `live-public-audit.md` — read-only public-browser evidence recorded separately from source-local tests and separated hostnames.
- `article-full-chain.tap` — exact isolated article suite output.
- `media-route-worker-fullchain.tap` — exact isolated media suite output.
- `url-validation-security.tap` — exact isolated security suite output.
- `auth-campaign-billing-regressions.tap`, `campaign-auth-static-regressions.tap`, `provider-accounting-security.tap`, and `worker-pipeline-policy.tap` — additional isolated offline regression outputs with per-suite counts/failure notes in §G.
- `source-coverage.md` — reviewed ranges, test evidence and explicit source gaps.
- `full-source-review/manifest.json`, `full-source-review/coverage-summary.json`, and `full-source-review/review-batches-001.jsonl` through `review-batches-007.jsonl` — exact source hashes, line counts, coverage totals, query batch inputs/ranges, and complete batch-aided review answers.

