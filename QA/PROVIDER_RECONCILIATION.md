# Historical Provider Reconciliation

**Status: BLOCKED / UNRECONCILED (known Phase 2 limit).**  
**Rule: unknown cost is neither reconciled nor zero.**

The uploaded prompt requires a field-by-field reconciliation of both historical
provider calls. Existing artifacts do not supply a complete chain for either
call. This document preserves the gaps instead of filling them from current
defaults, later calls, or explorer claims.

Latest provider retry, receipt-convergence, and schema evidence improve
future-call guardrails but do not reconstruct either historical call. Phase 2
therefore remains the known limit while selected later controls have final
isolated results.

## Gate decision

Paid reruns remain paused because both historical calls remain unreconciled and
live/provider gates are not authorized. Task #179 is confirmed merged at git
`0067e734`; final isolated receipt/accounting tests are recorded in the later
append-only section, while live/provider certification is still absent.

## Call 1 — original article generation

| Required field | Evidence-backed value | Reconciliation state |
|---|---|---|
| Call ID | Not retained | **UNKNOWN** |
| Time | `2026-09-10T16:23:00Z` reported in the accounting snapshot | **RECORDED / NOT RECONCILED** |
| User/project | Fixture team `2535` is the observer scope; exact user/project identity is not retained in the unresolved-call record | **PARTIAL / UNKNOWN** |
| Provider | Not retained in the unresolved-call record | **UNKNOWN** |
| Model | `gemini-3.5-flash` appears in the unresolved incident record; this does not prove the provider received the call | **RECORDED, not sufficient for reconciliation** |
| Request | Not retained | **UNKNOWN** |
| Response | Not retained | **UNKNOWN** |
| Tokens/units | Not retained | **UNKNOWN** |
| Cost | Not retained; do not use zero | **UNKNOWN / UNRECONCILED** |
| Receipt | No recoverable historical receipt identified | **UNKNOWN** |
| Database record | `0` ledger rows in the unresolved incident record | **RECORDED** |
| Job/retry chain | A historical article/batch context exists in surrounding artifacts, but the exact call-to-job binding is not retained in the incident record | **UNKNOWN** |
| Provider actually received call | Cannot determine from retained evidence | **UNKNOWN** |
| Billing/usage representation | No ledger representation for this unresolved incident | **UNRECONCILED** |

The reported timestamp and model are evidence fields, not proof that the
provider received the request. The single-call stress bound in historical
accounting is a coverage treatment, not an expense estimate.

## Call 2 — first QA audio/transcription verification

| Required field | Evidence-backed value | Reconciliation state |
|---|---|---|
| Call ID | Not retained; provider request ID is null | **UNKNOWN** |
| Time | Not retained | **UNKNOWN** |
| User/project | Team `2535`, article `2238` in the forensics artifact | **RECORDED / PARTIAL** |
| Provider | Not retained | **UNKNOWN** |
| Model | Not retained | **UNKNOWN** |
| Request | Not retained | **UNKNOWN** |
| Response | Not retained | **UNKNOWN** |
| Tokens/units | Not retained | **UNKNOWN** |
| Cost | Not retained; do not use zero | **UNKNOWN / UNRECONCILED** |
| Receipt | `PROVIDER_ACCOUNTING_FAILED`; no durable receipt identity recovered | **UNRECONCILED** |
| Database record | `0` ledger rows | **RECORDED** |
| Job/retry chain | Historical transcription artifact exists; exact original job and retry chain are not retained. Forensics made no paid call and did not retry. | **PARTIAL / UNKNOWN** |
| Provider actually received call | Physical outcome explicitly remains `unreconciled/unknown` | **UNKNOWN** |
| Billing/usage representation | Accounting failed before a durable usage row | **UNRECONCILED** |

The later verification-v2 request and ledger row are explicitly separate and
must not be attributed to this v1 call.

## Required resolution evidence

The accounting specialist must append evidence, not overwrite these unknowns:

- original harness/request identity or a provider-side record;
- provider/model/request/response/usage data with redacted payload handling;
- receipt status and immutable ledger source event;
- exact team/project/resource/job and retry identity;
- reservation/credit/cap treatment;
- proof that a second request is not being made during reconciliation.

If any field remains unavailable, the call remains `UNRECONCILED`. Reconciliation
must never infer a current model default, manufacture a cost, or retry the
provider.

## Current evidence index

| Evidence ID | Source | Relevance |
|---|---|---|
| E-001 | Uploaded certification prompt | Required reconciliation fields and no-invention rule. |
| E-008 | `reports/live-generation/accounting.json` | Two unresolved incident records, ledger snapshot, and reserve treatment. |
| E-011 | `reports/live-generation/assets/podcast-2238-transcription-v1-forensics.json` | Audio call has unknown physical outcome, usage, identity, and cost. |
| E-009 | `docs/provider-attempt-receipts-contract.md` | Future receipt behavior and historical limitation. |
| E-010 | Task #179 merge `0067e734` | Merge confirmed; future independent verification remains pending. |

Append-only evidence log entries are maintained in
`QA/CERTIFICATION_STATUS.md`; this document does not erase historical artifacts.

## Latest reconciliation boundary

The accounting maintenance suite is 15/15 offline checks, and architect
verification logs claim 102/102 unique receipts. Neither result supplies the
missing provider request, response, usage, cost, or physical-outcome fields for
the two historical calls. The 102/102 claim is verification-log evidence, not
an added rerun and not a provider-ledger count.

The canonical retained aggregate is **$0.517071 across 99 unique provider
events**. The earlier `$0.51707199` wording is a precision/spelling typo, not a
second amount. It is not an invoice and does not reconcile either unknown
call. The `$6` reserve remains a coverage treatment, not a fabricated ledger
event.

**Append-only evidence additions:** `E-012` accounting maintenance,
`E-018` independent security verification (which does not close financial
reconciliation), `E-020` architect receipt verification logs, and `E-021`
isolated migration/RLS evidence. Final checkpoint additions are `E-022`
through `E-030`; continuation evidence is recorded under E-038 through E-042.
Current Phase 2 disposition remains `UNKNOWN / UNRECONCILED` for both calls.

## Final provider and receipt boundary

The final provider regression contains 113 unique cases across two execution
modes. The first `final-provider-regression.tap` reports 108 pass and 5
database-guard failures. The same five database cases pass in the isolated
`provider-ledger-final.log` run. These are not 118 cases and are not an
aggregate provider-ledger count. No provider call was made.

Typed provider-accounting terminal errors are now checked before 429 or
transient-network classification; focused retry hardening is 10/10, with a
separate Daily Brief dependency-injection result of 4/4. Receipt DB/spool
convergence is 3/3, and migration 0035 passes its seven historical scenarios,
three canonical constraints, and receipt suite 3/3. These prove bounded local
or isolated behavior only; they do not reconcile either historical call.

The canonical retained aggregate is **$0.517071 across 99 unique provider
events**, not `$0.51707199`. It is not an invoice. Unknown historical usage
and cost remain neither reconciled nor zero, and no reconciliation retry or
paid rerun is authorized.

## Public browser evidence boundary

`E-030` (`QA/evidence/public-auth-browser.md`) records a passing
unauthenticated public-browser follow-up: the temporary cold/HMR navigation
delay was not reproduced after hard-load, a 20-second wait, and warmed pages;
no code fix was made. Hydrated forgot-password/back/signup/back navigation
passed, as did the 390x844 no-overflow check and the earlier native
validation controls. No sign-in, MFA, reset submission, or signup submission
was performed; safety interception caused no actual mutation, and expected
anonymous `/api/auth/me` 401s are not defects. This browser result does not
reconcile either historical provider call.

## Controlled execution continuation

E-037 records the exhaustive historical search result: no recoverable original
receipt was found for either unresolved call. The canonical retained aggregate
remains **99 unique provider events totaling `$0.517071`**. Both historical
calls remain `UNKNOWN / UNRECONCILED`; the `$6` reserve is a coverage treatment,
not spend approval, a ledger event, or an invoice. No reconciliation retry or
paid rerun is authorized.

The later controlled evidence does not close this Phase 2 limit:

- E-031 auth is a bounded 7/7 owned fixture/browser result with SMTP capture,
  not provider accounting evidence.
- E-032 is safe-local Redis/file/memory CAS load at 1/10/100, 2/2, with no
  PostgreSQL or live-provider path.
- E-033 is 5/5 service plus 6/6 route content sandbox coverage with explicit
  provider/database/queue/billing mocks.
- E-034 is corrected business acceptance 17/17 across five green TAP suites.
- E-035 is 9/9 media service tests with ownership/release/no-replay controls,
  not full orchestrator evidence.
- E-038 and E-039 now have controlled cross-run green observations, but they
  are not single-run full-chain certification. Article evidence is the union
  of three TAP runs: final 2 pass/3 historical fail, targeted 2 pass/1
  historical fail/2 skip, and shared-settlement 1 pass/0 fail/4 skip, with
  humanizer structure 1/1. Media evidence is RUN 3 rows 9/15/16 green plus
  targeted final rows 10/17 green and 3 skips; RUN 3 exit 124 teardown is
  historical and targeted exit 0 follows proper queue cleanup. The raw sources
  are `QA/evidence/article-full-chain-final.tap`,
  `article-full-chain-targeted.tap`, `article-shared-settlement-final.tap`,
  `humanizer-structure-regression.tap`, `media-fullchain-run3.log`, and
  `media-fullchain-final-targeted.tap`.
- E-040 is a fresh coherent 28/28 worker regression on owned PostgreSQL
  `127.0.0.1:55481` and Redis `127.0.0.1:16389`
  (`QA/evidence/continuation-worker-regression.tap`); it overlaps earlier
  scopes and must not be added to unique aggregate counts. The historical two
  provider calls remain `UNKNOWN / UNRECONCILED`, with no new funding or numeric
  maximum.
- E-041 is a Real-PostgreSQL targeted recovery/settlement crash retest:
  `QA/evidence/recovery-settlement-crash-retest.tap` is 1 pass/0 fail/8 skip.
  Recovery completion is LAST after idempotent debit, cap, and batch
  reconciliation, excluding the exact current run while other active siblings
  block. The prior `recovery-settlement-crash-final.tap` red
  fixture-missing-credit-balance result remains retained and superseded.

The production premature reserve release on retry and shared-sibling
billing-pending race are fixed behind a scoped run-reconciliation gate; this
controlled evidence does not verify live settlement. The external Redis `6379`
to `3001` mapping remains removed in the verified configuration. No main
workflow restart has occurred; a planned safe app restart after the code batch
is not claimed. No application/customer database migration, paid provider call,
real email, publication, or deployment occurred.

E-042 adds a read-only runtime boundary, not provider reconciliation: published
recurrent Neon HTTP fetches failed or sockets closed, and journey-scheduler
connections timed out. The development workflow reports Redis `6379
ECONNREFUSED` while effective configuration is `workersDisabled=false` and
`localRedisEnabled=true`. HTTP 200 health is not operational certification.
The normal workflow was not restarted because workers could enable potential
paid jobs without a paid cap; the owned Next UI was started/stopped and its
screenshot passed, with no app deployment or main restart. Explicit
authorization is required for a worker-enabled runtime retest after the
Neon/Redis/scheduler gap is addressed; a paid cap alone is not the only
remaining gate, and full-scope completion remains pending.
