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
isolated migration/RLS evidence. Final additions are `E-022` through `E-030`;
current Phase 2 disposition remains `UNKNOWN / UNRECONCILED` for both calls.

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
