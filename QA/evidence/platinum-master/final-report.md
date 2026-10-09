> UPDATE: The production build now PASSES. See persistence-results.md and production-build-final.log. The original findings below are a historical baseline; the release gate still fails on automatic Redis forwarding, and full readiness has outstanding configuration/evidence.

# CITEFI master audit — architect-assisted remediation

## Decision: NOT READY for production certification

Date: October 8, 2026 (America/New_York); verification continued October 9 UTC.

This pass read all 852 attachment lines and registered all 627 nonblank passages across 27 sections. An architect reviewed selected high-risk implementation paths. **This is not a completed line-by-line review of every application file, endpoint, or user journey.** Existing implementations were reused; no additional product roles or financial policies were invented.

Changes are local. DigitalOcean was not updated. No paid-generation QA, production migrations, customer-asset deletion, secret rotation, GitHub push, or deployment was performed. Existing historical live-QA holds were not reconciled or released.

## Baseline and actual verification

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS at baseline and after final callback changes; no reported diagnostics. The alleged 417 errors were not reproduced. | baseline-release.log; release-final.log |
| Authentication | 35 PASS, 0 failures/skips | baseline-auth.log |
| Admin notifications | 8 PASS, 0 failures/skips | baseline-admin-notifications.log |
| Approval links | 37 PASS, 0 failures/skips | baseline-approval-links.log |
| Budget stop | 14 PASS, 0 failures/skips | baseline-budget-stop.log |
| Publishing/scheduling/SDK policy regressions | 27 PASS, 0 failures/skips | publishing-policy.tap |
| Real disposable PostgreSQL/Redis and production publishing route handlers | 14 PASS, 0 failures/skips; external receiver calls and paid calls prohibited | publishing-db.log |
| Operations tests | 18 PASS during an intermediate successful release-gate run | Recorded tool output; latest release log does not reach this stage |
| **Latest authoritative release gate** | **FAIL: Redis port mapping reappeared following restart** | release-final.log |
| Exact production build command, owned disposable source tree/database/Redis, no real dotenv files | **BLOCKED: offline guard rejects Turbopack's dynamically allocated internal IPC port** | production-build.log |
| Public development page | Loads; screenshot inspected | homepage.jpg |
| Authenticated publishing page | Source changes inspected; protected UI not browser-tested | app/settings/publishing/page.tsx |
| DigitalOcean runtime, migrations, real generation/output usability, live payments and receiver compatibility | NOT VERIFIED in this pass | No production certification evidence |

**135 counted functional regression cases passed.** This includes offline unit/source-contract cases as well as real database/API fixtures, not 135 live end-to-end journeys. The four baseline suites were run on owned disposable services. The new integration suite was rerun after the final callback changes. Fixture clusters and connections were cleaned up. No tests blocked before execution were counted as passed.

Compiler investigation found the root Google API registry loading unrelated API declarations. Drive now uses the installed library's scoped factory/auth export. A fresh compiler-cache comparison resolved the apparent hang; types were not weakened. The SDK constructor/client methods were smoke-tested without external calls.

The build failure is **not evidence that application CSS is broken**: the reported CSS/Turbopack error includes the harness's explicit socket denial. A narrowly scoped IPC experiment did not establish a successful build and was not retained. The shared offline guard was not disabled or broadened. A clean production build remains an acceptance blocker.

## Findings and applied repairs

| Priority | Finding | Disposition / evidence |
|---|---|---|
| P0 | COMPLETE content could be submitted without current human approval | Requires approved, reviewed, nondeleted COMPLETE article; later article updates invalidate eligibility. Direct service and HTTP rejection verified. Full review-snapshot binding remains incomplete, below. |
| P0 | Repeated/concurrent submission could create distinct side effects | Transaction/advisory serialization, persisted payload/destination digest, existing-operation reuse; eight parallel submissions produce one database job. Stable queue identity is reused. |
| P0 | Lost receiver response, post-send exception, negative receipt, manual retry or crash recovery could resend already accepted work | Durable submission boundary; ambiguous outcomes stay `outcome_unknown` with no automatic retry. Retry rejects uncertain/delivered operations and preserves attempt history. Real database/API fault states verified; no real receiver acceptance was simulated as live evidence. |
| P0 | Late callback from attempt A could change attempt B | Signed dispatch-attempt anchor and transition fences. Late A ignored; matching B settles delivery; later failure cannot regress delivered. Missing attempt echo accepted only for a newly bound first attempt. |
| P0 | Ambient system authority in public callback handler | Replaced with bounded `runWithSystemContext`; service authority does not deliberately escape the callback promise. Route integration rerun. |
| P1 | Oversized callback bodies and unsafe published links | Streamed byte limit, UUID validation, bounded HTTPS URL without embedded credentials. Oversized body without Content-Length and malformed/executable/credential-bearing URLs rejected without state changes. |
| P1 | Delayed worker could dispatch for archived/deleted workspace | Locks/revalidates workspace, connection, article and formatted payload before claim. Archived workspace and stale approval fixtures cannot reach submission. |
| P1 | Enqueue metadata update could make a pending job unclaimable or overwrite dispatch state | Queue-reference update no longer changes pending status; status predicate fences metadata update. Concurrent admission integration verifies pending remains claimable. |
| P1 | Credit-release failure could still cancel its spending-cap reservation | Ordered cleanup helper: uncertain credit release prevents cap cancellation; credit or cap cleanup failure requires reconciliation. Fault-injection/order tests pass. This is not live financial reconciliation. |
| P1 | Retry UI offered unsafe resets and uncertain jobs lacked explicit label | Server derives `retryable`; UI only offers eligible retries and labels “Needs reconciliation.” Private contract metadata omitted from job-list response. API verified; protected UI browser verification remains outstanding. |
| P1 | Build configuration opted out of TypeScript failures | `ignoreBuildErrors` set false; independent TypeScript and source-contract checks pass. Full build still blocked by harness IPC. |
| P0 release gate | Redis daemon remained wildcard-bound despite private new-daemon flags | Opted-in development bootstrap also secures reused daemon; no flush or deliberate data-clearing operation added. Restart verification showed bind `127.0.0.1`, protected mode `yes`. **Port mapping itself returned on restart, so release gate correctly stays red.** |

Relevant implementation: `lib/publishing/dispatch-policy.ts`, `lib/publishing/index.ts`, callback/retry/jobs routes, `lib/publishing/callback-state.ts`, `lib/scheduled-reservation-cleanup.ts`, scheduled worker, publishing settings, Google Drive helper, Next config and local bootstrap.

## Remaining blockers and unverified acceptance

1. **P0 — exact approval contract is only partially implemented.** Current approval freshness and the queued payload/destination hash protect article edits and post-admission drift. They do not prove that the human reviewed the precise original asset bytes, destination/account identity and all material metadata. Asset mutation before admission, credential/account changes on a stable origin, assignment/revocation policy and alternate editor paths need review-snapshot design plus tests. Do not call section 10.4 complete.
2. **P0 release gate — exposed-port configuration does not persist.** Removing Redis's mapping through the validated configuration path briefly produced a green gate, but restart restored `localPort = 6379`. Do not weaken the deployment contract. Resolve the managed port configuration and verify persistence across restart.
3. **Build acceptance — clean production build is not certified.** Support only explicitly owned Turbopack IPC targets in an isolated build harness or run a separately authorized staging build with safe credentials. Do not allow arbitrary localhost or replace production build settings to conceal failure.
4. **Development readiness/configuration —** startup reports missing `CANARY_ACCOUNTING_TEAM_ID` and `API_KEY_ENCRYPTION_SECRET`; readiness remains false and health returns 503. These are workspace observations, not proof that DigitalOcean has the same configuration. Accounting owner and encryption setup require authorized configuration, not arbitrary customer selection or secret rotation.
5. **P1 — safe reconciliation workflow missing.** Unknown/legacy operations pause rather than resend. There is no completed operator UI/evidence workflow to establish accepted/not-accepted, audit adjudication, and authorize any new operation. Historical live-provider attempts remain unreconciled.
6. **P1 compatibility —** legacy queued jobs without contracts do not gain invented approval or receipts; they fail closed. Legacy/multiple-attempt CMS callbacks need explicit attempt echo. Video/social publishing is blocked until compatible review binding exists. Existing generation features were not replaced.
7. **Unverified critical domains —** complete wallet/payment/refund concurrency, all generation entry points, native provider COGS and margins, Campaign/Ads/export/agency reports, every tenant/admin/revocation path, OAuth refresh, storage parity, privacy/deletion/retention, pagination/accessibility, analytical correctness, notifications, production scale and backup/restore. Code existence and historical tests are not current full acceptance.

## Persona and future-scenario coverage

| Persona / scenario | Evidence this pass | Remaining coverage |
|---|---|---|
| Regular authenticated member | Owned publishing admission/retry/list API, approval rejection, immutable queued operation | Complete generation/edit/review/publish browser journey; subscription states and quotas |
| Workspace owner / platform admin | Baseline auth/admin-notification suites; same dispatch service has no new bypass | Full admin recovery, overrides, financial adjustments, suspension, offboarding and audit trail |
| Client reviewer | Publishing submit/retry forbidden after role change | Every assigned review, asset, export and report boundary |
| Other tenant | Publishing admission rejects foreign connection/content scope | Exhaustive route/resource enumeration, workers, cache, search and signed assets |
| Archived client workspace | Otherwise approved queued operation cannot dispatch | Agency/client handoff, restore and in-flight lifecycle transitions |
| External receiver | Valid signed callbacks; stale/current attempts; terminal state; body/URL rejection | Live protocol/timeout/crash/key-rotation interoperability |
| Double-clicks/concurrent tabs, lost response, crashed dispatch, delayed webhook | Real database/API fault states plus offline policy cases | Native receiver reconciliation and operator adjudication |
| Finance/support/SCIM/legal-hold or other hypothetical roles | No new roles/features created | Product applicability must be established; not claimed implemented |

## Requirement traceability and section coverage

`requirements-registry.json` preserves source-line references, disposition, evidence, risk, dependency and rollback fields. Structural headings are registered as source passages, not separate implemented features. Unverified rows remain unverified rather than inheriting a whole-section PASS.

| Sections | Coverage |
|---|---|
| 1–4 | Mission/rules/baseline/release policy read; baseline recorded, NOT READY applied; full build baseline incomplete |
| 5 | Typecheck and reported harness allegations reproduced as current passes; strict build config repaired; latest release/build gates blocked |
| 6 | Selected auth/tenant/admin baseline plus bounded callback and archived-client repairs; exhaustive security review incomplete |
| 7 | Budget baseline and ordered-cleanup fault cases; no live financial acceptance |
| 8 | Selected publishing concurrency, retry, callback, crash and delayed-claim paths repaired/tested; reconciliation and full authorization contract incomplete |
| 9–12 | Existing Campaign, content, Ads, COGS and agency services considered by architect; no wholesale replacements; functional/full live acceptance outstanding |
| 13 | Selected HMAC/body/URL and SDK paths verified; OAuth, secrets lifecycle, SSRF inventory and storage not exhaustively verified |
| 14–17 | Privacy, complete persona matrix, accessibility and analytics read; selected persona slices only; not certified |
| 18–19 | Selected dispatch/scheduling faults, Redis and offline operations checks; scale, staging, production and disaster recovery not certified |
| 20–22 | Completeness/model drift/customer trust read; selected SDK and admin-notification evidence only |
| 23–27 | Required matrix, safe sequencing, definition of done, deliverables and operating directive read; partial evidence registered; full definition of done NOT satisfied |

## Rollback and next actions

No database schema migrations were added. New dispatch metadata is in existing JSON fields; statuses use the existing varchar column. Downgrading to the old retry/callback code is **unsafe** because it can resend uncertain work. If rollback is required, keep publishing workers stopped until an authorized operator inventories ambiguous jobs and preserves their dispatch/financial history. Do not delete jobs, release holds, reset attempts or fabricate native receipts to make dashboards green.

Finish exact approval/authorization binding and reconciliation; stabilize private port configuration; certify a clean build; configure an approved accounting owner and compatible encryption setup; complete the remaining persona/critical-journey matrix in staging. Only then consider an authorized DigitalOcean update and separately bounded native-provider QA. No release risk was silently accepted.
