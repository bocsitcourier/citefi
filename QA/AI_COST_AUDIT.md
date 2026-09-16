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
current dispositions are appended under E-022 through E-030 below, with the
later E-038 through E-042 continuation evidence recorded separately.

## Cost-control matrix

| Control | Source | Mock | Local integration | Live | Current disposition |
|---|---|---|---|---|---|
| Request identity to provider submission | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Receipt specialist report required |
| Provider usage capture | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Unknown historical usage remains |
| Cost-rate selection and model identity | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Current defaults cannot repair history |
| Receipt-to-ledger linkage | RECORDED / UNVERIFIED | PENDING | 3/3 WITH LIMITATION (`E-027`) | BLOCKED | Isolated convergence passes; live/provider path remains blocked |
| Retry/duplicate charge prevention | RECORDED / UNVERIFIED | PENDING | 3/3 WITH LIMITATION (`E-027`) | BLOCKED | No live-provider proof; isolated no-replay path passes |
| Cap reservation/debit/release | RECORDED / UNVERIFIED | CONTROLLED — E-038/E-040/E-041 | CONTROLLED — E-038/E-040/E-041 | BLOCKED | Retry release and shared-sibling billing-pending race fixed under scoped reconciliation; idempotent debit/cap recovery retest is controlled only; no live settlement claim |
| Cancellation/partial completion settlement | RECORDED / UNVERIFIED | CONTROLLED — E-038 | CONTROLLED — E-038 | BLOCKED | Cross-run article settlement evidence only; paused two-article `-20` ledger assertion is correct, no live/provider settlement |
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
final checkpoint `E-022` through `E-030`; continuation evidence is recorded
under E-038 through E-042 below.

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

## Controlled execution continuation

E-037 records an exhaustive historical search with no recoverable original
receipts. The retained accounting remains **99 unique provider events at
`$0.517071`**. Both historical calls are still `UNKNOWN / UNRECONCILED`; the
`$6` reserve is coverage treatment only and is not spend approval, a ledger
event, or an invoice.

| Evidence | Current result | Cost boundary |
|---|---|---|
| E-031 | Auth fixture 7/7 plus bounded browser/email-MFA SMTP capture | No provider spend or new ledger event. |
| E-032 | Safe-local load 2/2 with owned Redis and file/memory CAS at 1/10/100; strict-spool message fix | No PostgreSQL, live provider, or production-capacity measurement. |
| E-033 | Content service 5/5 and route 6/6 over 19 rows | Provider, DB, queue, and billing are mocks; no spend or settlement. |
| E-034 | Business acceptance 17/17 in five green TAP suites | Controlled local seams only; earlier agency command exit 127 red evidence remains. |
| E-035 | Media service tests 9/9 with ownership/release/no-replay assertions | Boundary/service evidence, not full orchestrator settlement. |
| E-036 | Read-only public route statuses, including anonymous `/api/auth/me` 401 | No paid action, deployment change, publication, or email spend. |
| E-037 | No original receipts recovered; two calls remain unknown | Historical gate remains paused; reserve is not approval. |
| E-038 | Article full-chain cross-run union (`article-full-chain-final.tap`, `article-full-chain-targeted.tap`, `article-shared-settlement-final.tap`): five unique cases green across three runs, not one 5/5; final 2 pass/3 historical fail, targeted 2 pass/1 historical fail/2 skip, shared-settlement 1 pass/0 fail/4 skip; humanizer 1/1 | Deterministic-humanizer Markdown flattening, renderability guard, premature retry reserve release/shared-sibling billing-pending race, and scoped reconciliation gate are fixed in controlled evidence; no full-feature/live settlement certification. |
| E-039 | Media full-chain cross-run union (`media-fullchain-run3.log`, `media-fullchain-final-targeted.tap`): RUN 3 rows 9/15/16 pass with historical exit 124 teardown; targeted final rows 10/17 pass, 3 skips, clean exit 0 after queue cleanup | Identity tenant context is fixed at `/api/media/assets/[identity]/regenerate`; row-17 fixture brand corrected without validator weakening; no full-feature/live media settlement claim. |
| E-040 | Fresh continuation worker regression 28/28 on canonical owned PostgreSQL `127.0.0.1:55481` and Redis `127.0.0.1:16389` | Restart, budget-stop, pipeline-billing, receipt-CAS, and RLS cases are green; overlapping scopes are not a unique aggregate, and old 8/8 is not a new run. |
| E-041 | Real-PostgreSQL targeted recovery-settlement-crash retest 1 pass/0 fail/8 skip; completion is LAST after idempotent debit, cap, and batch reconciliation with exact current-run exclusion while other active siblings block | Controlled recovery evidence only; prior red `recovery-settlement-crash-final.tap` missing-credit-balance fixture is retained and superseded. No provider spend, live settlement, or new funding claim. |
| E-042 | Read-only runtime logs show published recurrent Neon HTTP fetch/socket failures and journey-scheduler timeouts; development Redis `6379 ECONNREFUSED`; effective `workersDisabled=false`, `localRedisEnabled=true`; owned Next UI screenshot passed and latest typecheck is clean | HTTP 200 health is not operational certification. Normal workflow was not restarted because workers could enable potential paid jobs without a paid cap; no deployment/main restart. Full-scope completion remains pending runtime authorization/remediation, not paid-cap approval alone. |

The earlier helper/summary `17` claim is ignored until an actual green TAP
supports it. No main workflow restart has occurred; a planned safe app restart
after the code batch is not claimed. No application/customer DB migration,
paid provider call, real customer email, publication, or deployment occurred.
The external Redis `6379` to `3001` mapping remains removed in the verified
configuration. The two historical calls remain unknown with no new funding or
numeric maximum.

E-042 is not a paid-cap-only gate: the published Neon/HTTP and journey-scheduler
failures plus development Redis refusal are known runtime gaps. Explicit
authorization is required before a worker-enabled runtime retest after
remediation; controlled recovery evidence does not create spend or certify the
full feature scope.
