# Citefi Platform-Wide Code Audit

**Date:** 2026-09-02  
**Verdict:** **FAIL / NO-GO**  
**Mode:** Read-only audit; no product defects were changed during this review.

## Executive conclusion

The current repository cannot be certified as sound across the platform. The public homepage responds successfully, but the platform health endpoint returns 503, the release gate fails, TypeScript reports 295 errors, three configured test workflows fail, and the review identified material security, billing, worker, UI-contract, and deployment defects.

This review used five independent architect passes, repository-wide TypeScript and release checks, configured integration workflows, focused billing/canary/operations tests, live health checks, dependency auditing, static application security scanning, and privacy/dataflow scanning.

No code review can prove the absence of every undiscovered defect. This report records what was inspected, reproduced, and not verified.

## Blocking findings

### P0 — Cookie-authenticated mutations lack a platform-wide CSRF defense

Authentication cookies use `SameSite=None`, while destructive and administrative handlers do not consistently validate an origin or CSRF token. Cross-site requests may be able to invoke actions such as disabling MFA, deleting an account, changing the active team, or performing administrative mutations.

Evidence:

- `app/api/auth/login/route.ts:232-242`
- `app/api/auth/verify-2fa/route.ts:221-229`
- `app/api/auth/disable-totp/route.ts:19-27`
- `app/api/account/delete/route.ts:25-70`
- `app/api/auth/team-context/route.ts:19-99`

Required correction: introduce one mandatory CSRF control for every cookie-authenticated unsafe method, with strict origin validation compatible with the Replit preview.

### P0 — Credit reservations are not safely owned and settled per run

Reservation creation uses a read-then-insert flow without a database uniqueness guarantee for a run. Partial debit/release logic guards the team aggregate but does not maintain an authoritative remaining balance for each reservation. Concurrent retries can duplicate reservations, and one run can consume credits held by another run.

Evidence:

- `lib/billing.ts:192-226`
- `lib/billing.ts:274-287`
- `lib/billing.ts:452-474`
- `lib/billing.ts:743-754`
- `shared/schema.ts:3183-3197`

Required correction: enforce unique reservation ownership in PostgreSQL and use atomic per-reservation remaining/debited/released amounts.

### P0 — Subscription refunds do not reliably reverse usable allowance credits

Subscription grants and refund reversals operate on different credit buckets. Stripe can complete a refund while the corresponding allowance remains spendable, and the local reversal is best-effort. Refund/dispute webhook coverage is incomplete.

Evidence:

- `lib/billing.ts:822-830`
- `lib/credits.ts:289-305`
- `app/api/admin/billing/refund/route.ts:132-169`
- `app/api/billing/webhook/route.ts:136-362`

Required correction: persist grant/payment provenance and reverse the same bucket through an idempotent outbox/retry workflow and Stripe refund/dispute events.

### P1 — 2FA method binding is unsafe and email 2FA is not a complete user journey

The verification route trusts a caller-selected method instead of binding the login challenge to the account's configured method. Separately, email verification expects a `login_2fa` code, but the verification screen has no send/resend step, preventing email-2FA users from completing sign-in.

Evidence:

- `app/api/auth/verify-2fa/route.ts:22-125`
- `app/api/auth/send-email-code/route.ts:20-87`
- `app/api/auth/login/route.ts:153-173`
- `app/verify-2fa/page.tsx:21-134`

Required correction: create a server-issued, single-use, method-bound challenge after password validation; rate-limit issuance; and add a complete email-code UX and regression tests.

### P1 — Invite acceptance and seat enforcement are raceable

Invite validity and seat capacity are read before the transaction. The transaction later updates the invite by ID without requiring it to still be pending. Concurrent revocation or acceptance can overwrite state, and concurrent acceptances can exceed seat limits.

Evidence:

- `app/api/admin/invites/accept/[token]/route.ts:46-56`
- `app/api/admin/invites/accept/[token]/route.ts:78-106`
- `app/api/admin/invites/accept/[token]/route.ts:146-153`

Required correction: conditionally consume the pending invite inside one transaction and serialize or constrain seat allocation.

### P1 — Ads approval roles do not enforce the locked governance model

Any authenticated team member can submit client or policy approval. Only export has an owner/admin restriction, so a normal agency member can satisfy both prerequisites.

Evidence:

- `app/api/campaigns/[id]/ads/[adId]/approve/route.ts:17-25`
- `lib/campaign-ads-service.ts:345-366`

Required correction: bind client approval to a designated client approver and policy approval to an explicit compliance/administrative role.

### P1 — Delivered social content can be released and regenerated after debit failure

Some social and legacy video processors throw an ordinary error when settlement fails. The shared worker only preserves a reservation for `BillingSettlementError`; the ordinary error path can release credits after durable content exists and then retry provider generation.

Evidence:

- `lib/social-worker.ts:217-398`
- `lib/social-worker.ts:605-618`
- `lib/worker.ts:2037-2058`
- `lib/pipeline-worker.ts:482-516`

Required correction: standardize all delivered-content settlement on durable checkpoints and the typed settlement error used by the safe video-idea path.

### P1 — Cancelled queued batches can be resurrected

The batch worker can overwrite a cancelled batch to `RUNNING`, create article rows, and enqueue generation jobs.

Evidence:

- `lib/worker.ts:2194-2200`
- `lib/worker.ts:2291-2332`

Required correction: use an atomic guarded state transition and recheck cancellation before every child enqueue.

### P1 — Social-triggered video bypasses normal billing and slot controls

The social worker can enqueue video generation without a credit run ID. Budget enforcement and billing are conditional on that ID, unlike the explicit video-generation API.

Evidence:

- `lib/social-worker.ts:495-503`
- `lib/worker.ts:1916-1919`
- `lib/worker.ts:2037-2072`
- `app/api/social/video/generate/route.ts:137-224`

Required correction: route this path through the same reservation, budget, and per-user slot flow as explicit video generation.

### P1 — Cost ceilings fail open when accounting fails

The cost-ceiling check reads non-authoritative telemetry and returns zero spend on query errors. Paid retries can therefore continue when accounting is unavailable.

Evidence:

- `lib/cost-ceilings.ts:47-66`

Required correction: use the committed provider-usage ledger and fail closed or trip a durable breaker when spend cannot be established.

### P1 — Tenant scoping is missing from publishing-connection selection

Auto-publishing chooses configured connection IDs without a team predicate before creating a publishing job.

Evidence:

- `lib/worker.ts:5741-5761`

Required correction: require the connection's team ID to match the batch team at selection and creation time.

### P1 — Public object access can expose customer media

The public-object route accepts arbitrary paths without authentication, while storage helpers place uploaded assets under a public prefix.

Evidence:

- `app/api/public-objects/[...path]/route.ts:6-20`
- `lib/storage.ts:176-197`
- `lib/storage.ts:256-286`

Required correction: physically separate publishable assets from private tenant assets and authorize all private object reads.

### P1 — Release readiness is false or incomplete

The release gate fails because `.replit` exposes Redis. TypeScript is deliberately omitted from the gate even though governance requires it. Health can treat missing storage as acceptable and can report worker readiness despite scheduler registration failures.

Evidence:

- `.replit:17-19`
- `scripts/validate-release.sh:2-8`
- `tests/deployment/deploy-contract.test.sh:212-214`
- `lib/ops/health.ts:228-232`
- `lib/worker.ts:5100-5146`
- `server/worker-process.ts:124-132`
- `app/api/health/route.ts:102-169`

Required correction: restore a green release contract, include repository type checking, and make required capability and worker-registration checks fail closed.

## Additional material findings

- Invited users can bypass the normal password-complexity policy; invite acceptance checks only length.
- The client review page exists but is absent from normal client navigation.
- Two Next.js dynamic route handlers use the old synchronous `params` contract, contributing to build/type failures.
- Model resolution can commit unverified model IDs and Veo remains unvalidated.
- The legacy deployment script and process-manager working directory disagree and bypass the immutable deployment path.
- Deployment host-key setup trusts live `ssh-keyscan` output instead of a pinned fingerprint.
- Password-reset codes and raw invite URLs/recipient details are written to logs in development/legacy paths.
- The development workflow attempted a duplicate server start and hit `EADDRINUSE`.
- Production/deployment logs contain repeated Neon fetch/connection timeouts affecting recovery scans, schedulers, and sweepers.

## Automated security scans

### Dependency audit

- Critical: 0
- High: 55
- Moderate: 49
- Low: 11

The advisories require package-by-package reachability and compatible-upgrade triage before remediation.

### Static application security scan

- Critical: 2
- High: 4
- Medium: 2

The two reported SQL-injection findings in `lib/db.ts` appear to be scanner false positives because the shown queries use fixed SQL with positional parameters. Four receiver-package filesystem findings require path-boundary testing; current slug sanitization reduces risk but was not proven for every path.

### Privacy/dataflow scan

- Critical: 2
- Medium: 4
- Low: 15

The two reported critical API-key logging findings are false positives: the code logs only `set` or `missing`, not secret values. Real logging concerns remain for password-reset codes, invite URLs/tokens, and email addresses.

## Verification results

| Check | Result |
|---|---|
| Public homepage | PASS — HTTP 200 |
| Platform health | FAIL — HTTP 503; degraded and canary never run |
| `npm run check` | FAIL — 295 TypeScript errors |
| `npm run validate:release` | FAIL |
| Deployment contract | FAIL — Redis port exposed in `.replit` |
| Operations tests | PASS — 9/9 |
| Authentication tests | PASS — 26/26 |
| Reservation state-machine tests | PASS — 13/13 |
| Canary tests | PASS — 26/26 |
| Approval-link workflow | FAIL — tenant-context setup errors and cancellations |
| Admin-notification workflow | FAIL — server readiness timeout and cleanup error |
| Budget-stop workflow | FAIL — 2/3 pass; provider-ledger cleanup FK failure |

Passing focused tests do not invalidate the architectural defects above; several missing adversarial/concurrency cases are not covered by those suites.

## TypeScript failure distribution

The 295 errors include production code, test code, and generated Next validators. High-volume locations include:

- `app/api/billing/webhook/route.ts`
- `app/settings/brief/page.tsx`
- `lib/approval-token.ts`
- `lib/credits.ts`
- `lib/worker.ts`
- `lib/podcast-worker.ts`
- `app/api/content/[id]/route.ts`
- `app/api/social_posts/[id]/route.ts`
- Dynamic route validators for agency clients and team invites

One directly actionable runtime defect surfaced in `app/api/media/from-url/route.ts`: `teamId` is referenced without being defined.

## Audit coverage and limitations

Architect review was split across:

1. Authentication, authorization, 2FA, invitations, teams, and tenant isolation
2. Billing, credits, Stripe, entitlements, Ads governance, and provider accounting
3. Generation pipelines, workers, queues, recovery, publishing, and storage
4. UI/API contracts and representative critical journeys
5. Deployment, health, configuration, migrations, backup/restore evidence, and launch certification

The audit did not execute real Stripe events, email delivery, destructive backup restoration, external publishing, paid provider generations, or every browser journey. Production remains subject to the existing independent certification NO-GO.

## Required remediation order

1. CSRF protection and method-bound 2FA
2. Credit reservation ownership, refund reversal, and settlement safety
3. Invite/seat concurrency and Ads approval authorization
4. Cancellation-safe workers and unified billing for every generation path
5. Tenant-safe object and publishing access
6. TypeScript/build restoration and route-contract fixes
7. Release/health/worker-readiness corrections
8. Logging cleanup and dependency/receiver-path security triage
9. Re-run all checks, staging drills, rollback/restore drills, and independent certification

Until these are completed and independently rechecked, Citefi remains **NO-GO** for production certification.