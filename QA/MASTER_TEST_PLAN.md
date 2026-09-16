# CiteFi Master Test Plan

**Plan state: MAINTENANCE UPDATED — Phase 1 complete; controlled execution in progress.**  
**Certification gate: NOT CERTIFIED.**

This plan implements the exact uploaded certification prompt
(`E-001`) without claiming work that has not produced a report. The feature
scope is the 40-row source inventory in
`reports/live-generation/masterinventory.json` (`E-006`), in source order.
The six rows marked `NOT_TESTABLE` there are **NOT APPLICABLE** until a product
contract exists. The seven historical `PASS` rows are retained evidence, not
new passes.

Latest execution evidence is incorporated below. Earlier `PENDING` values remain
valid only where no current evidence ID is listed; they are not a claim that all
work is still pending.

## Execution rules

1. Keep source, mock, local integration, and live evidence in separate columns.
2. Mark each column `PENDING` until the specialist report and evidence ID are
   available.
3. A source assertion, stale explorer claim, or historical report cannot
   promote a current feature to `VERIFIED`.
4. Do not perform paid generation, external publication, advertising spend, or
   real customer email without explicit authorization and a bounded operation
   record.
5. Use synthetic, tenant-owned fixtures only; never read customer incidents or
   customer content for QA.
6. For every provider-backed operation, record
   `REQUEST → PROVIDER → RESPONSE → TOKENS/UNITS → COST → RECEIPT → USAGE →
   OUTPUT`, including the no-call path.
7. No test count is assumed. A count appears only in a specialist report that
   identifies the executed command, scope, and evidence.

## Four-specialist execution lanes

| Lane | Owner | Required scope | Current source | Mock | Local integration | Live |
|---|---|---|---|---|---|---|
| Accounting | Accounting specialist | Two historical calls, Task #179 receipt path, idempotency, usage/cost, cap/credit settlement, accounting outage and reconciliation | Discovery complete | PENDING | PENDING | BLOCKED until historical gate and authorization |
| Generation | Generation specialist | All supported article, image, audio, video, SEO, social, campaign, brand, and report pipelines; validation and durable output | Discovery complete | PENDING | PENDING | BLOCKED for paid/provider paths until gate |
| Security | Security specialist | Auth/authz, tenant ownership, IDOR, CSRF, injection/XSS, upload/object access, secrets, admin boundaries | Discovery complete | PENDING | PENDING | PENDING — no live customer action |
| Operations | Operations specialist | Queue identity, worker retries, restart/failure recovery, storage, migrations, deployment, concurrency and scale risk | Discovery complete | PENDING | PENDING | PENDING — no restart or external side effect in this initialization |

## Gate sequence

### Gate A — fixture and evidence controls

- Identify a synthetic fixture tenant, project, content, media, queue, and
  report context without touching customer records.
- Verify the database target and migration state before any integration run.
- Prepare an append-only evidence ID, redaction review, and rollback/cleanup
  record.
- Confirm the operation mode (`source`, `mock`, `local integration`, or
  `live`) in the report header.

### Gate B — historical reconciliation

Reconcile both historical calls field by field. Unknown fields remain unknown;
unknown cost is not zero. No future paid run proceeds while either call remains
unreconciled.

### Gate C — receipt/accounting contract

Task #179 is confirmed merged at `0067e734`. The merge is not a verification
result. Future tests must independently prove:

- admission is fail-closed when durable receipt fallback is unavailable;
- one logical invocation cannot create two physical paid submissions;
- provider-returned usage is captured before/independently of ledger insertion;
- missing or partial usage is not replaced with zero;
- deterministic ledger source IDs are idempotent;
- retries, cancellation, worker restart, and accounting failure do not
  double-charge;
- receipt ownership/tenant boundaries and sanitized metadata hold;
- reconciliation never invokes a provider or fabricates usage.

### Gate D — supported pipeline execution

For each supported source row, execute positive, negative, boundary, and
recovery cases at the least expensive authorized mode first. Each report must
separately show request validation, provider boundary, response validation,
storage/retrieval, database state, receipt/usage/cost, and output contract.

### Gate E — adversarial and operational execution

Use deterministic faults or isolated local infrastructure for timeout, 429,
500, malformed/empty response, database/storage failure, refresh/closure,
worker restart, duplicate request/webhook, concurrent request, cancellation,
and partial completion. Live external side effects remain blocked.

### Gate F — status decision

Only an evidence-bearing specialist report may change a row. A historical
`PASS` remains historical unless the current report satisfies the same
contract and scope. A failure of a deterministic/mock check cannot be called a
live provider failure, and a live output cannot be called a clean pass when
validation or accounting is incomplete.

## Source inventory execution register

The canonical exact-name register is maintained in
`QA/CERTIFICATION_STATUS.md` and `QA/REGRESSION_MATRIX.md`. The source order is
the JSON order in `E-006`; no explorer row numbering is used. Every supported
row begins with:

| Source | Mock | Local integration | Live | Current execution state |
|---|---|---|---|---|
| Discovery recorded, not certification | PENDING | PENDING | PENDING or historical evidence marked UNVERIFIED | No row may be promoted without a report |

The following source rows are explicitly **NOT APPLICABLE** until a product
contract is added: `Landing-page generation`, `AI email-campaign generation`,
`Live Google/Meta ad publishing and spend`, `Provider-backed image editing or
inpainting`, `Atomic article-to-all-channels flywheel`, and `Threads and
YouTube generation contracts`.

## Acceptance record template

Each specialist report must include this exact minimum record:

```text
Evidence ID:
Feature name (exact masterinventory spelling):
Source row (source JSON order):
Execution mode: source | mock | local integration | live
Fixture/tenant ownership:
Request and route:
Provider/model or deterministic path:
Response/output:
Validation result:
Persisted records and retrieval:
Receipt ID/source event/usage/cost:
Retry/duplicate/cancellation/restart behavior:
Observed status:
Known limitations:
Next evidence dependency:
```

Blank fields are `UNKNOWN` or `PENDING`; they are never inferred.

## Paid and external blockers

The paid gate is blocked by the two unresolved historical provider calls and
the need for independent receipt-accounting tests. External publication,
advertising spend, and real email delivery require separate authorization and
test accounts. The plan records these blockers and proceeds with controlled
offline/mock/local work rather than asking for an ad hoc next target.

## Evidence and handoff

Use the evidence index and append-only log in
`QA/CERTIFICATION_STATUS.md`. Do not edit the older canonical remediation
documents in this initialization. Specialist reports must append new evidence
IDs and identify stale-document claims as `UNVERIFIED` until actual execution
supports them.

## Latest execution checkpoint

| Workstream | Current result | Mode and limitation |
|---|---|---|
| Accounting maintenance | 15/15 maintenance checks pass | Offline guard/source and injected behavior only; no provider or application DB. |
| Scope 0 generation guardrails | 39/39 pass across seven fresh processes | Deterministic/mock route and service coverage only. |
| Real queue acceptance | 5/5 pass across four fresh commands | Owned isolated Redis fixture on `127.0.0.1:16379`; no full pipeline/provider result. |
| Canary | 27/27 pass in a separate manual TAP against the owned isolated Redis fixture | Do not combine with 5/5 or Scope 0 counts. |
| Receipt/provider convergence | Final regression is 113 unique across two modes; 108 pass + 5 DB guards, same 5 pass in isolated ledger mode; architect logs separately claim 102/102 unique | No duplicate count or provider/live claim; receipt convergence is isolated evidence. |
| Database fixture | Final maintenance 51/51 and extended isolated batch 45/45; earlier 65/48/17 remains historical red evidence | No policy weakening; disposable local integration only. |
| Receipt migration/RLS | 0035 seven historical scenarios, three constraints, receipt suite 3/3 | Disposable migration/grants/RLS/client-viewer evidence; no application/customer DB migration. |
| Security independent verification | Suite counts preserved separately | DNS fixed/retested 13 SSRF + 1 original SSRF, 11 auth/CSRF, 3 reset-route, 6 existing, 1 original password; no combined duplicate total. |
| Security residual | DNS-resolution deadline fixed and independently retested | Offline/mock scope; deployed/full security remains limited. |
| Scans | Dependency 0, SAST 0, HoundDog 4 privacy (1 medium, 3 low) | Triage is recorded in the security report; scan results are not full certification. |

## Corrected defect triage

The maintenance records retract the earlier false branding, batch-count,
exact-filename migration, and deployment-start findings. The public branding
change is intentional; the extra batch lookup is legacy-ID compatibility; full
`0034` filenames are intentional ordering keys; and `0020` is the intentional
deployment migration baseline. The real `.replit` issue was the external
Redis `6379` to `3001` mapping, which was removed; internal Redis 6379 remains.
No deployment or restart was performed.

The previously remaining concrete security issue was the unbounded
DNS-resolution wait in `safeFetchWithRedirects`, affecting the media import,
site crawler, and video style analyzer sinks. It is fixed and independently
retested in the final security evidence; deployed/live behavior remains outside
the gate.

## Current phase gates

- **Phase 1:** complete.
- **Phase 2:** known limit; both historical provider calls remain
  `UNKNOWN / UNRECONCILED`, and unknown cost is not zero.
- **Phases 3–7:** in progress with the evidence above; no full feature row may
  become `VERIFIED` from these isolated results.
- Paid generation, external publishing, advertising spend, and real email
  remain blocked. The plan records the blockers and does not request an
  unscoped next action.

Earlier checkpoint evidence IDs: `E-012` through `E-021` in
`QA/CERTIFICATION_STATUS.md`; final IDs are listed below.

## Final execution disposition

This final view supersedes the earlier checkpoint wherever E-022 through E-030
provide a newer result. Earlier red logs remain retained and are not silently
converted into passes.

| Workstream | Final current result | Mode and limitation |
|---|---|---|
| Provider retry/accounting | Typed accounting terminals are checked before 429/transient classification; hardening is 10/10 and Daily Brief injection is 4/4. The final provider regression is 113 unique cases across two modes: 108 pass plus 5 DB-guard failures in the first TAP, with the same 5 passing in isolated ledger mode. | No provider call or application/customer DB; do not count the five cases twice or call this 113/113 pass. |
| Typecheck | Final and later TypeScript checks pass with no diagnostics. | Typecheck evidence only; 0035 SQL was locally tested and no application/customer migration occurred. |
| Security | DNS deadline fixed/retested with 13/13 helper/three-sink plus 1/1 original SSRF; auth/CSRF 11/11, reset 3/3, existing 6/6. Architect approval covers tested auth/SSRF origins. | Offline/mock/helper and route-boundary scope; live/deployed security remains outside the gate. |
| Database/operations | Maintenance 51/51; extended isolated 45/45; real queue 5/5; separate canary 27/27; latest restart durability 8/8 after actual SPEED MODE Markdown-to-HTML correction. | Isolated fixtures; prior 65/48/17 and pre-correction red logs remain historical. |
| Receipt durability/schema | Receipt DB/spool convergence 3/3; migration 0035 has seven historical scenarios, three constraints, and receipt suite 3/3 after predicate fix. | Disposable local PostgreSQL/spool only; no application/customer DB migration. |
| Browser observation | Public forms render. The temporary cold/HMR navigation delay was not reproduced after hard-load, 20-second wait, and warmed pages; no code fix. Hydrated forgot-password/back/signup/back navigation passes; 390x844 mobile has no overflow; earlier toggle, remember-checkbox, required-empty, and invalid-email native validation remain passed. | Public unauthenticated observation only; no sign-in, MFA, reset submission, or signup submission. Expected `/api/auth/me` 401s are not defects; safety interception caused no actual mutation. |

Historical provider reconciliation remains the known Phase 2 limit:
**$0.517071 across 99 unique provider events** is a retained aggregate, not an
invoice, and both historical calls remain `UNKNOWN / UNRECONCILED`. No
publishing, advertising, real email, paid provider call, deployment, workflow
restart, or customer/application database migration occurred. The six
unsupported rows remain `NOT APPLICABLE`; supported rows remain `UNVERIFIED` or
`BLOCKED`; no full feature is source-only `VERIFIED`.

Final evidence summary: `QA/evidence/final-execution-summary.md`. Final IDs:
`E-022` through `E-030`.
