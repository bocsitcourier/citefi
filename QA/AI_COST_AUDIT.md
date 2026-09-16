# AI Cost and Usage Audit

**Current disposition: IN PROGRESS / COST GATE BLOCKED; full system remains
NOT CERTIFIED.**

This audit distinguishes recorded ledger valuation from a provider invoice.
Unknown usage is not free, and unknown cost is not zero. No cost is invented
for the two historical calls.

The latest offline receipt guardrails and architect verification logs are
progress evidence only. They do not add spend, create a ledger row, or close
the historical reconciliation gate.

## Retained historical accounting snapshot

The current source artifact (`E-008`) records:

- shared authorization ceiling: `$50.000000` (not an invoice);
- recorded provider-ledger valuation: `$0.517071`;
- unique provider-ledger event count: `99` in that historical snapshot;
- unresolved reserve treatment: `$6.000000` held as a coverage reserve, not as a
  fabricated ledger event;
- two unresolved physical-call incidents: original article generation and first
  QA audio/transcription verification;
- both unresolved incidents have unknown cost. Neither is reconciled and
  neither is zero;
- the priced verification-v2 event is a separate later call and is counted
  only as documented in the source artifact;
- the paid-call gate remains paused while the combined unresolved bound is not
  confirmed; final isolated receipt checks do not authorize paid work.

These are values reported by the retained artifact, not new measurements made
by this documentation handoff.

The matrix below is the retained initialization plan. Its `PENDING` and
`BLOCKED` cells remain the planned mode boundaries; the final evidence-bearing
current dispositions are appended under E-022 through E-030 below.

## Cost-control matrix

| Control | Source | Mock | Local integration | Live | Current disposition |
|---|---|---|---|---|---|
| Request identity to provider submission | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Receipt specialist report required |
| Provider usage capture | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Unknown historical usage remains |
| Cost-rate selection and model identity | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Current defaults cannot repair history |
| Receipt-to-ledger linkage | RECORDED / UNVERIFIED | PENDING | 3/3 WITH LIMITATION (`E-027`) | BLOCKED | Isolated convergence passes; live/provider path remains blocked |
| Retry/duplicate charge prevention | RECORDED / UNVERIFIED | PENDING | 3/3 WITH LIMITATION (`E-027`) | BLOCKED | No live-provider proof; isolated no-replay path passes |
| Cap reservation/debit/release | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | No paid retest authorized |
| Cancellation/partial completion settlement | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Local fault tests pending |
| Accounting failure after provider response | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Historical audio call remains unresolved |
| Cost visibility to tenant/client | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Security/accounting report required |
| 10x/100x rate, queue, and reservation behavior | PREDICTED RISK ONLY | PENDING | PENDING | BLOCKED | No load result is claimed |

## Historical unresolved calls

See `QA/PROVIDER_RECONCILIATION.md` for the required
`CALL ID → TIME → USER/PROJECT → PROVIDER → MODEL → REQUEST → RESPONSE →
TOKENS → COST → RECEIPT → DATABASE RECORD → JOB → RETRIES → BILLING/USAGE`
chain. Current known state is:

| Incident | Ledger rows | Usage | Cost | Status |
|---|---:|---|---|---|
| Original article generation | 0 in retained incident record | Unknown | Unknown, not zero | UNRECONCILED |
| First QA audio/transcription verification | 0 in retained forensics | Unknown | Unknown, not zero | UNRECONCILED |

## FinOps acceptance requirements

Before any paid retest, the accounting specialist must provide:

- expected provider/model/operation and maximum spend;
- expected logical invocation and receipt identity;
- expected usage units and ledger source event;
- cap/credit reservation and settlement expectation;
- duplicate/retry behavior;
- accounting-failure recovery that does not retry the provider;
- reconciliation evidence for both historical incidents or an explicit
  continued blocker.

No external provider, advertising, publication, or email spend is authorized
by this document.

Evidence IDs and the append-only current-view/log are maintained in
`QA/CERTIFICATION_STATUS.md`.

## Latest maintenance cost disposition

| Evidence | Result | Cost interpretation |
|---|---|---|
| Accounting maintenance (`E-012`) | 15/15 offline checks pass | No provider call or spend; guardrail evidence only. |
| Architect receipt verification (`E-020`) | 102/102 unique receipt cases claimed | Not provider usage, not a ledger count, and no reruns added. |
| Historical accounting snapshot (`E-008`) | 99 unique provider events and `$0.517071` | Recorded historical valuation, not invoice; no `$0.51707199` amount is recognized. |
| Historical calls | Two incidents, both cost unknown | Neither reconciled nor zero; paid gate remains paused. |
| Final provider regression (`E-023`) | 113 unique cases across two modes; 108 pass plus 5 DB guards, with the same 5 passing in isolated ledger mode | No duplicate aggregate and no provider spend; the five cases are not counted twice. |
| Receipt convergence/schema (`E-027`, `E-028`) | Receipt convergence 3/3; 0035 historical scenarios/constraints and receipt suite 3/3 | Accounting/spool/schema behavior only; no new cost, provider call, or application DB migration. |

The separate local receipt migration/RLS pass (`E-021`) and final 0035 checks
verify schema controls, not cost. Database maintenance is now 51/51 and the
extended isolated batch is 45/45; the earlier 65 total / 48 pass / 17 fail
fixture remains historical red evidence. None changes the recorded cost
snapshot or permits paid work.

**Append-only evidence additions:** `E-012`, `E-015`, `E-020`, `E-021`, and
final `E-022` through `E-030`.

## Final cost boundary

The final retry, convergence, migration, queue, durability, and typecheck
results do not create an invoice or reconcile either historical provider call.
The canonical retained valuation remains **$0.517071 across 99 unique provider
events**. Both historical calls remain `UNKNOWN / UNRECONCILED`; unknown usage
and cost are neither reconciled nor zero. No paid provider, publishing,
advertising, email, or customer/application database operation occurred.

## Public browser evidence boundary

`E-030` (`QA/evidence/public-auth-browser.md`) adds only passing
unauthenticated public-browser observations: cold/HMR navigation was not
reproduced as a blocker after hard-load/warm-up, hydrated
forgot-password/back/signup/back navigation passed, and mobile 390x844 had no
overflow. Earlier native validation controls remained passed. No sign-in, MFA,
reset submission, or signup submission was performed; safety interception
caused no actual mutation, and expected anonymous `/api/auth/me` 401s are not
defects. This creates no usage, cost, invoice, or paid-provider authorization.
