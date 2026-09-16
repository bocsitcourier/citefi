provider call, real email, publication, or deployment occurred.

# CiteFi Regression Matrix

**Matrix state: MAINTENANCE UPDATED — current certification remains NOT CERTIFIED.**

The matrix uses the exact feature names and source order from
`reports/live-generation/masterinventory.json` (`E-006`). It does not use
explorer-derived row numbering. Historical grades are displayed separately
from current certification. `PENDING` means no specialist report is attached.

The initial matrix remains preserved. The latest evidence-bearing maintenance
view below supersedes `PENDING` for the listed controls only; it does not
upgrade any full feature row or change the exact 40 source names.

## Status columns

| Column | Allowed interpretation |
|---|---|
| Source | Static source/discovery evidence only; never a runtime pass. |
| Mock | Deterministic/provider-stub execution; no live billing/output claim. |
| Local integration | Isolated database/queue/storage execution; no external side-effect claim. |
| Live | Authorized current runtime/provider execution; historical artifacts are labeled UNVERIFIED. |
| Current disposition | `UNVERIFIED`, `BLOCKED`, or `NOT APPLICABLE` at initialization. |

## Exact 40-row matrix

| Row | Exact feature name | Historical grade | Source | Mock | Local integration | Live | Current disposition |
|---:|---|---|---|---|---|---|---|
| 1 | Article title pool and topic research | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 2 | Batch article generation | `FAIL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 3 | Single article regeneration | `FAIL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 4 | Batch title regeneration | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | PENDING | UNVERIFIED |
| 5 | Article metadata regeneration | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | PENDING | UNVERIFIED |
| 6 | Article reformatting | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | PENDING | UNVERIFIED |
| 7 | Article and batch hyperlink transforms | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | PENDING | UNVERIFIED |
| 8 | Direct hero and media image regeneration | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 9 | Batch image and caption repair | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | PENDING | UNVERIFIED |
| 10 | Identity-based social/media image regeneration | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | PENDING | UNVERIFIED |
| 11 | Social text generation | `FAIL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 12 | Social variant regeneration | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | PENDING | UNVERIFIED |
| 13 | Social image generation | `FAIL` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 14 | Social slideshow video | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | PENDING | UNVERIFIED |
| 15 | Idea video | `FAIL` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 16 | Like-this video | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | PENDING | UNVERIFIED |
| 17 | Podcast generation | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED SERVICE COVERAGE — E-035 | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 18 | SEO content audit | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 19 | SEO local research | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 20 | SEO competitor analysis | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 21 | SEO schema markup | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 22 | SEO content structure | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 23 | SEO pillar and cluster planning | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 24 | SEO create articles | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 25 | Daily brief generation | `BLOCKED` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | BLOCKED | BLOCKED | BLOCKED |
| 26 | Campaign ad copy generation | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 27 | Campaign brand confirmation and intelligence context | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |
| 28 | Journey orchestration and recommendations | `BLOCKED` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | BLOCKED | BLOCKED | BLOCKED |
| 29 | Learning, corpus mining and decisioning analysis | `BLOCKED` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | BLOCKED | BLOCKED | BLOCKED |
| 30 | Admin incident AI analysis | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | PENDING | PENDING | UNVERIFIED |
| 31 | Admin SEO report generation | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | PENDING | PENDING | UNVERIFIED |
| 32 | Agency report rendering and delivery | `PARTIAL` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | PENDING | UNVERIFIED / historical | UNVERIFIED |
| 33 | Content publication adapters | `NOT_RUN` | RECORDED / UNVERIFIED | CONTROLLED COVERAGE — E-034 (17/17 business suite) | PENDING | BLOCKED / no-publish authorization | UNVERIFIED |
| 34 | Landing-page generation | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 35 | AI email-campaign generation | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 36 | Live Google/Meta ad publishing and spend | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 37 | Provider-backed image editing or inpainting | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 38 | Atomic article-to-all-channels flywheel | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 39 | Threads and YouTube generation contracts | `NOT_TESTABLE` | SOURCE-CONFIRMED unsupported | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE | NOT APPLICABLE |
| 40 | Standalone Brand Intelligence | `PASS` | RECORDED / UNVERIFIED | CONTROLLED PASS — E-033 sandbox | PENDING | HISTORICAL PASS / not new | UNVERIFIED |

## Cross-cutting regression controls

| Control family | Source | Mock | Local integration | Live | Current state |
|---|---|---|---|---|---|
| Auth/session/CSRF and tenant ownership | RECORDED / UNVERIFIED | CONTROLLED — E-031 auth 7/7 plus bounded browser evidence | CONTROLLED fixture boundary — E-031 | PENDING | Controlled owned evidence only; no full/deployed certification |
| Prompt injection and malformed structured output | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | No uncontrolled provider call |
| Queue duplicate/retry/cancel/restart | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Operations specialist report required |
| Receipt uniqueness and accounting failure | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Accounting specialist report required |
| Storage/retrieval/export integrity | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Generation/operations report required |
| Publication/email external effects | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Separate authorization required |
| Migration ordering and RLS | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Full-filename 0034 behavior is not a confirmed bug |

## Regression decision rule

No historical `PASS` row becomes current `VERIFIED` merely because it appears in
an older report. No `FAIL` or `BLOCKED` row is silently downgraded. A specialist
report must identify the exact source row, execution mode, evidence ID,
reproduction, result, and any limitation. Tests are not claimed or counted
until those reports are available.

Task #179 merge `0067e734` is a prerequisite evidence fact, not a regression
pass. The 15/15 maintenance checks and 102/102 architect verification claim
remain historical checkpoints; final isolated production-code-path receipt
tests are recorded below, while live provider/accounting certification remains
blocked.

The evidence index and append-only log are maintained in
`QA/CERTIFICATION_STATUS.md`.

## Latest evidence-bearing regression view

| Regression/control group | Current result | Evidence mode | Current feature effect |
|---|---|---|---|
| Scope 0 fresh guardrails | 39/39 pass across seven fresh processes | Mock/source-boundary | Guardrail only; no full-feature `VERIFIED`. |
| Real queue-ID acceptance | 5/5 pass across four fresh commands | Owned isolated Redis fixture on `127.0.0.1:16379` | Queue contract only; no provider/full pipeline pass. |
| Canary worker | 27/27 pass in a separate manual TAP against the owned isolated Redis fixture | Owned isolated Redis/manual | Separate from 5/5; no combined count or feature promotion. |
| Provider circuit breaker | 4/4 pass in its own isolated TAP | Owned isolated Redis/manual | Separate operations guardrail. |
| Receipt maintenance | 15/15 pass | Offline/injected | No paid/live receipt certification. |
| Architect receipt uniqueness | 102/102 claimed | Verification logs | No reruns added; not a ledger/event count. |
| Database fixture batch | 51/51 maintenance; separate extended batch 45/45 | Disposable local integration | Earlier 65/48/17 remains historical red evidence; no policy weakening. |
| Receipt migration/RLS | 0035 seven historical scenarios, three constraints, receipt suite 3/3 | Disposable local integration | Narrow schema/convergence evidence only; no application DB migration. |
| Security independent suites | 13 SSRF, 1 original SSRF, 11 auth/CSRF, 3 route, 6 existing, 1 original password | Offline independent suites | DNS deadline fixed/retested; keep suites distinct and do not combine totals. |
| Receipt/provider final regression | 113 unique across two modes; 108 pass + 5 DB guards, same 5 pass in isolated ledger mode | Offline + disposable local integration | Same five are not duplicated; no provider/live feature promotion. |
| Restart/durability | Fresh continuation worker regression 28/28 on canonical owned PostgreSQL `127.0.0.1:55481` and Redis `127.0.0.1:16389`; restart, budget-stop, pipeline-billing, receipt-CAS, and RLS cases green | Isolated local integration | Earlier 11-total/9-pass/2-fail durability log and old 8/8 handoff remain historical; overlapping cases are not a unique aggregate. |
| Scans | Dependency 0, SAST 0, HoundDog 4 privacy (1 medium/3 low) | Callback scan | Triage only; no full security certification. |

## Maintenance retractions and retained fix

The false branding, batch-count, exact-filename migration, and deployment
start-version findings are retracted in `E-014`. The real configuration
finding was `.replit` exposing internal Redis `6379` as external `3001`; only
that external mapping was removed. Internal 6379 remains for the developer
workflow/test contract. No deployment or restart occurred.

The exact 40 inventory names and their current feature dispositions remain the
same: supported rows are `UNVERIFIED` or `BLOCKED`, six source-unsupported
rows are `NOT APPLICABLE`, and the seven historical `PASS` rows are not new
passes. The latest isolated results do not create source-only `VERIFIED`
features.

Latest evidence IDs: `E-012` through `E-042` in
`QA/CERTIFICATION_STATUS.md`.

## Final current regression view

The following final view supersedes the preceding checkpoint only for named
controls. It preserves the exact 40-row inventory and does not turn isolated
controls into feature-level `VERIFIED` rows.

| Control group | Final result | Current disposition |
|---|---|---|
| Provider retry/accounting | Hardening 10/10; Daily Brief 4/4; final regression 113 unique cross-mode cases (108 pass + 5 DB guards, same 5 isolated pass) | Guardrail and isolated ledger evidence; no paid/provider claim. |
| Security | DNS deadline fixed/retested 13/13 plus original SSRF 1/1; auth/CSRF 11/11; reset 3/3; existing 6/6 | Named offline controls limited; architect auth/SSRF origin approval is not live deployment certification. |
| Database | 51/51 maintenance and 45/45 extended | Local fixture evidence; earlier 65/48/17 retained historical. |
| Queue/canary | Real owned queue 5/5; separate canary 27/27 | Distinct isolated operational guardrails. |
| Restart/speed mode | Fresh continuation worker regression 28/28; humanizer structure regression 1/1 | Isolated controlled evidence; real deterministic-humanizer Markdown flattening bug fixed and renderability guard retained validated original with warning; old 8/8 is not a new run. |
| Receipt convergence | DB/spool production receipt path 3/3 | Isolated production-code-path evidence; no live provider or customer DB. |
| Receipt 0035 migration | Seven historical scenarios, three constraints, receipt suite 3/3 after predicate fix | Disposable local migration only; no app DB migration. |
| Browser observation | `E-030`: temporary cold/HMR delay not reproduced after hard-load/20-second wait/warmed pages; hydrated forgot-password/back/signup/back navigation passes; 390x844 has no overflow; earlier toggle/remember/required/invalid-email native validation remains passed | Public unauthenticated observation only; no sign-in, MFA, reset submission, or signup submission. Expected `/api/auth/me` 401s are not defects; safety interception caused no actual mutation. |

Historical provider reconciliation remains `UNKNOWN / UNRECONCILED` for both
calls. The aggregate is **$0.517071 across 99 unique provider events**, not an
invoice. Supported rows remain `UNVERIFIED` or `BLOCKED`, six unsupported rows
remain `NOT APPLICABLE`, and historical `PASS` rows are not new passes.

Final evidence summary: `QA/evidence/final-execution-summary.md`. Final
evidence IDs: `E-022` through `E-042`.

## Controlled execution continuation

E-033, E-034, and E-035 now provide controlled service and/or route coverage for
all 34 supported inventory rows: 19 rows in the content sandbox, the media
service set for rows 8–10 and 13–17, and rows 25 and 28–33 in the business
acceptance suites. The exact 40 names and source order remain unchanged.
Controlled coverage is not a current full-feature or live `VERIFIED` result;
supported rows remain `UNVERIFIED` or `BLOCKED`, and six unsupported rows remain
`NOT APPLICABLE`.

| Evidence | Current result | Matrix disposition |
|---|---|---|
| E-031 | Auth fixture 7/7; bounded real Next UI browser login/refresh/90-day remember-me/logout/protected denial/email MFA with SMTP capture | Controlled owned fixture/browser evidence; unresolved unknown-resource `403` URLs are non-core observations. Guessed `/api/auth/session` 404 is not a bug; `/api/auth/me` is the known route. |
| E-032 | Safe-local 2/2 Redis/file/memory CAS load with 1/10/100 latency measurements and strict-spool message fix | Local guardrail only; no DB/live/capacity result. |
| E-033 | 5/5 service and 6/6 route content acceptance, 19 rows | Mock controlled coverage; no provider/DB/queue/billing/live certification. |
| E-034 | Corrected business acceptance 17/17; five TAP suites green | Controlled seam coverage; earlier agency command exit 127 red log retained and earlier helper `17` claim ignored. |
| E-035 | Media service acceptance 9/9 with ownership/release-count/no-replay assertions | Service/boundary coverage; full routes/orchestrators unverified. |
| E-036 | Read-only public statuses login 200, forgot-password 200, signup 200, health 200, anonymous `/api/auth/me` 401 | Observation only; no deployment or paid/publication action. |
| E-037 | Exhaustive search recovered no original receipts; 99/$0.517071 retained; two calls unknown; `$6` reserve not approval | Historical reconciliation remains blocked. |
| E-038 | Article full-chain union across three TAP runs: five unique cases green, not one 5/5; final 2 pass/3 historical fail, targeted 2 pass/1 historical fail/2 skip, shared-settlement 1 pass/0 fail/4 skip; humanizer 1/1 | Controlled cross-run evidence only; billing/reconciliation and renderability fixes are covered, but no full-feature/live settlement certification. |
| E-039 | Media full-chain union: RUN 3 rows 9/15/16 pass with historical exit 124 teardown; targeted final rows 10/17 pass, 3 skips, clean exit 0 after queue cleanup; all five unique cases green | Controlled cross-run evidence only; identity tenant-context and row-17 fixture-brand fixes are covered without validator weakening; no full-feature/live media certification. |
| E-040 | Fresh continuation-worker regression 28/28 on owned PostgreSQL/Redis | Overlapping controlled regression; do not add to earlier counts as a unique aggregate. |
| E-041 | Real-PostgreSQL targeted recovery-settlement-crash retest 1 pass/0 fail/8 skip; completion LAST after idempotent debit, cap, and batch reconciliation with exact current-run exclusion while other active siblings block | Controlled recovery evidence only; prior red `recovery-settlement-crash-final.tap` missing-credit-balance fixture is retained and superseded. |
| E-042 | Read-only runtime logs: published recurrent Neon HTTP fetch/socket failures and journey-scheduler timeouts; development Redis `6379 ECONNREFUSED`; effective `workersDisabled=false`, `localRedisEnabled=true`; owned Next UI screenshot passed; latest typecheck clean | HTTP 200 health is not operational certification. No normal workflow restart because workers could enable potential paid jobs without a paid cap; no deployment/main restart. Full-scope completion remains pending explicit runtime authorization/remediation, not paid-cap approval alone. |

The production premature reserve release on retry and shared-sibling
billing-pending race are fixed behind a scoped reconciliation gate; this does
not verify live settlement. The external Redis `6379` to `3001` mapping remains
removed in the verified configuration. No main workflow restart has occurred;
a planned safe app restart after the code batch is not claimed. No
application/customer DB migration, paid provider call, real email, publication,
or deployment occurred.

E-041 closes the named recovery crash hole only in controlled Real PostgreSQL
evidence. E-042 leaves the known published Neon/HTTP, journey-scheduler, and
development Redis runtime gap. Explicit authorization is required before a
worker-enabled runtime retest after remediation; the owned Next UI screenshot
does not establish operational certification or full-scope completion.