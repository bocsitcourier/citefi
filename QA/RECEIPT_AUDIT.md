# Provider Receipt and Accounting Audit

**Current disposition: VERIFIED WITH LIMITATION for isolated guardrails;
full receipt/accounting path remains UNVERIFIED.**  
**Task #179: confirmed merged at git `0067e734`; final isolated tests recorded,
live/provider tests still needed.**

This is a source-trace and test-initialization record. It does not assume that
the merged receipt-accounting changes work at runtime. No provider call or
reconciliation is performed by this document.

Latest maintenance evidence is now attached. It is not a new paid run and does
not promote a full generation feature.

The source-traced matrix below is retained initialization context. The final
evidence-bearing receipt, convergence, and migration dispositions are appended
under E-022 through E-030; continuation evidence E-038 through E-042 is
recorded below and does not certify a live provider path.

## Source-traced contract

The discovery records and `docs/provider-attempt-receipts-contract.md` describe
the intended contract:

- tenant/resource ownership is checked before admission and submission;
- a durable receipt is prepared before the paid SDK call;
- a submitted gate uses compare-and-set behavior to prevent automatic replay;
- a shared durable spool is required when configured fallback storage is used;
- provider-returned usage is required and missing usage is not replaced with
  zero;
- response capture is independent from the immutable usage-ledger insert;
- deterministic source event IDs make reconciliation idempotent;
- reconciliation reads captured usage and never calls the provider or invents
  usage;
- logical invocation identity is distinct from delivery count and resource ID;
- retries, cancellation, worker restart, and accounting failure require
  explicit evidence.

These are contract/source findings, not runtime verification.

## Audit matrix

| Control | Source | Mock | Local integration | Live | Current result |
|---|---|---|---|---|---|
| Ownership before admission | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | No runtime result |
| One physical submit per logical invocation | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | No runtime result |
| Receipt ID/source-event uniqueness | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | No runtime result |
| Known provider usage required | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | No runtime result |
| Missing/partial usage is non-zero-inventing | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | No paid test authorized |
| Response survives ledger insert failure | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | No runtime result |
| Idempotent reconciliation | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Historical calls remain unresolved |
| Retry/cancel/restart behavior | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | No current report |
| Shared spool readiness and permissions | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Environment-specific evidence required |
| Sanitized receipt metadata | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | Payload/secret exclusion requires report |
| Tenant ownership during reconciliation | RECORDED / UNVERIFIED | PENDING | PENDING | PENDING | No runtime result |
| Migration, RLS, grants, and deploy target | RECORDED / UNVERIFIED | PENDING | PENDING | BLOCKED | Controlled target verification required |

## Required independent tests

The accounting specialist must run or report the following in isolated,
authorized modes, identifying every mode separately:

1. provider response followed by database/ledger failure, with receipt/spool
   capture and idempotent reconciliation;
2. concurrent workers sharing one invocation identity, proving one submit;
3. each adapter boundary (text, image, audio, video, search, and auxiliary
   LLM) with safe metadata and provider-native usage;
4. missing and partial usage, proving no invented zero;
5. spool readiness, permissions, malformed records, and shared-worker access;
6. cap/credit reservation races and error-policy propagation;
7. restart/recovery and tenant ownership;
8. migration/RLS/storage grants and client non-exposure.

No test count is recorded until a specialist report is attached.

## Migration filename note

`0034_agency_report_period_unique.sql` and
`0034_provider_attempt_receipts.sql` are intentionally distinct full filenames.
The full filename is the ordering key. Their existence is a source feature to
exercise in a controlled migration test, not a confirmed duplicate-filename
bug. This audit does not relabel it as a defect.

## Audit gate

Receipt status cannot be called fully `VERIFIED` from source review, a merge
notification, or stale explorer output. The two historical provider calls in
`QA/PROVIDER_RECONCILIATION.md` remain unreconciled. Final isolated
production-code-path receipt tests are recorded below, while live receipt
coverage remains blocked.

Evidence IDs and append-only logging are maintained in
`QA/CERTIFICATION_STATUS.md` (`E-001`–`E-011` at initialization).

## Latest receipt verification and maintenance

| Evidence | Result | Boundary |
|---|---|---|
| Accounting maintenance (`E-012`) | 15/15 offline maintenance checks pass | Boundary, receipt regression, and social terminal behavior under injected/offline execution; no provider/application DB. |
| Architect verification logs (`E-020`) | 102/102 unique receipt cases claimed verified | Record as architect verification evidence; do not add reruns or treat 102 as provider-ledger events. |
| Isolated receipt migration/RLS (`E-021`) | Pass | Migration repeatability, grants, forced RLS, tenant/campaign ownership, and client-viewer restriction in disposable infrastructure; not production certification. |
| Historical ledger snapshot (`E-008`) | 99 unique provider events, `$0.517071` recorded valuation | Historical snapshot only; distinct from the 102 receipt-verification claims and not an invoice. |
| Final provider regression (`E-023`) | 113 unique cases across two modes; 108 pass plus 5 DB guards, then the same 5 pass in isolated ledger mode | Do not count the same five twice; no provider call and no full-feature promotion. |
| Receipt convergence (`E-027`) | 3/3 | Production receipt-store/CAS and DB/spool recovery path in disposable isolated PostgreSQL; no provider replay. |
| Receipt migration hardening (`E-028`) | Seven historical scenarios, three constraints, receipt suite 3/3 | 0035 predicate fix and idempotent local migration; no application/customer DB migration. |

The final isolated production-code-path results close the named local
convergence and schema scenarios, but they do not close the two historical
unreconciled calls or certify a live provider response. No new provider rerun
is counted in this update. The 102/102 architect claim remains a separate
historical verification-log count.

**Append-only evidence additions:** `E-012`, `E-020`, `E-021`, and final
checkpoint `E-022` through `E-030`; continuation evidence is recorded under
E-038 through `E-042`.

## Final current disposition

The actual receipt convergence implementation now finalizes the primary row
with provider request ID, exact response usage, metadata, captured/accounted
timestamps, and cleared stale failure fields. Reconciliation writes the
immutable ledger first, then heals the primary and independent spool without
calling or replaying the provider. Accounted fast paths verify tenant,
provider, model, and attempt identity.

Migration `0035_provider_attempt_receipt_state_hardening.sql` uses the
corrected JSON numeric predicate, downgrades unsupported terminal rows without
inventing usage, and clears `accounted_at` on downgrade. Seven historical
fixture scenarios, all three canonical state constraints, and the 3/3 receipt
suite passed in disposable local PostgreSQL. The first receipt red result is
retained as historical and superseded by this named final result.

## Public browser evidence boundary

`E-030` (`QA/evidence/public-auth-browser.md`) is public unauthenticated UI
evidence only. The temporary cold/HMR navigation delay was not reproduced after
hard-load, a 20-second wait, and warmed pages; no code fix was made. Hydrated
forgot-password/back/signup/back navigation and the 390x844 no-overflow check
passed, with earlier native validation controls remaining passed. No sign-in,
MFA, reset submission, or signup submission was performed; safety interception
caused no actual mutation, and expected anonymous `/api/auth/me` 401s are not
defects. It does not change the receipt or provider certification boundary.

## Controlled execution continuation

The new evidence narrows controlled boundaries but does not make the receipt
path fully verified:

| Evidence | Current result | Receipt/accounting boundary |
|---|---|---|
| E-031 | Auth HTTP 7/7 and bounded browser/email-MFA SMTP capture | No provider accounting or paid submission. |
| E-032 | Safe-local 2/2 owned Redis plus file/memory CAS load at 1/10/100; strict-spool message fix | No PostgreSQL/live provider; earlier strict-spool red proof remains retained. |
| E-033 | Content service 5/5 and route 6/6 over 19 rows | Explicit provider/DB/queue/billing mocks; no receipt or settlement certification. |
| E-034 | Business acceptance 17/17 across five green TAP suites | Controlled local seams; no paid email/publication settlement. |
| E-035 | Media service tests 9/9 with enhanced ownership, release-count, receipt, and no-replay assertions | Service/boundary evidence; full routes/orchestrators remain unverified. |
| E-036 | Read-only public route statuses and anonymous `/api/auth/me` 401 | No paid action, deployment change, publication, or provider receipt. |
| E-037 | No recoverable original receipts; 99 events/$0.517071 retained; two calls unknown; `$6` reserve not approval | Historical reconciliation remains blocked and no retry is authorized. |
| E-038 | Article full-chain controlled cross-run result: five unique cases green across three runs, not one 5/5; final 2 pass/3 historical fail, targeted 2 pass/1 historical fail/2 skip, shared-settlement 1 pass/0 fail/4 skip; humanizer 1/1 | Deterministic-humanizer Markdown flattening and renderability guard are fixed; premature retry reserve release/shared-sibling billing-pending race is fixed behind scoped reconciliation. Controlled evidence only; no live settlement. |
| E-039 | Media full-chain controlled cross-run result: RUN 3 rows 9/15/16 pass with historical exit 124 teardown; targeted final rows 10/17 pass, 3 skips, clean exit 0 after queue cleanup | Identity tenant context is fixed at `/api/media/assets/[identity]/regenerate`; row-17 fixture brand corrected without validator weakening. Controlled evidence only; no full orchestrator/live settlement inference. |
| E-040 | Fresh continuation worker regression 28/28 on canonical owned PostgreSQL `127.0.0.1:55481` and Redis `127.0.0.1:16389` | Restart, budget-stop, pipeline-billing, receipt-CAS, and RLS coverage is green; overlaps earlier scopes and is not added to unique aggregate counts. |
| E-041 | Real-PostgreSQL targeted recovery-settlement-crash retest 1 pass/0 fail/8 skip; completion is LAST after idempotent debit, cap, and batch reconciliation with exact current-run exclusion while other active siblings block | Controlled recovery evidence only; prior `recovery-settlement-crash-final.tap` red fixture-missing-credit-balance result is retained and superseded. No live/provider settlement certification. |
| E-042 | Read-only runtime logs show published recurrent Neon HTTP fetch/socket failures and journey-scheduler timeouts; development Redis `6379 ECONNREFUSED` with effective `workersDisabled=false`, `localRedisEnabled=true`; owned Next UI screenshot passed; latest typecheck clean | HTTP 200 health is not operational certification. Normal workflow was not restarted because workers could enable potential paid jobs without a paid cap; no deployment/main restart. Full-scope completion remains pending explicit runtime authorization/remediation, not paid-cap approval alone. |

Unknown-resource browser `403` URLs remain unresolved observations rather than a
core receipt defect. A guessed `/api/auth/session` 404 is not a bug because it
is not an application route; `/api/auth/me` is the known route. The earlier
helper/summary `17` claim is ignored until an actual green TAP supports it.
The external Redis `6379` to `3001` mapping remains removed in the verified
configuration. No main workflow restart has occurred; a planned safe app
restart after the code batch is not claimed. No application/customer DB
migration, paid provider call, real email, publication, or deployment occurred.

E-041 closes only the named recovery crash hole in controlled Real PostgreSQL
evidence. E-042 is a known runtime gap: published Neon/HTTP and
journey-scheduler failures plus development Redis refusal require remediation
and explicit authorization before a worker-enabled runtime retest. A paid cap
alone is not the only remaining gate, and full-scope completion remains
pending.
