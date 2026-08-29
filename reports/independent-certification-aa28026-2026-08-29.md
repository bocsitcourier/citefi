# Citefi Independent Release Certification

## Certification record

| Field | Value |
|---|---|
| Release candidate | `aa28026f6cb5f7b3219ba6254ac999c2753a8c5b` |
| Certification date | 2026-08-29 |
| Certification task | Independently certify the complete Citefi build |
| Blueprint baseline | Locked 2026-08-22 blueprint, requirements inventory, decision register, and launch checklist |
| Production target | Existing DigitalOcean droplet |
| Decision | **NO-GO — NOT LAUNCH-READY** |

## Signed decision

I independently reviewed and exercised release candidate `aa28026`. The candidate is **not certified for production launch**. This is a blocking decision, not a conditional pass.

Production must not be deployed or switched to this candidate until the blocking findings below are remediated by their responsible implementation work and a new independent certification produces release-specific passing evidence.

**Signed:** Replit Agent, independent software certification reviewer  
**Date:** 2026-08-29

## Executive basis

The release contains substantial, working controls: tenant RLS, agency/client report separation, immutable deployment machinery, production builds, local release validation, public-page rendering, independent uptime monitoring, and backup evidence. Those controls do not offset failed mandatory gates.

The candidate currently fails type safety, critical configured workflows, campaign-context coverage, provider-accounting coverage, dependency security policy, authenticated journey coverage, and release-specific staging/rollback/restore/canary evidence. Architect review also found an end-to-end campaign export and approval-ownership authorization gap.

## Blocking findings

### 1. Type safety is not green

- `npm run check` exits nonzero.
- The latest run fails while parsing generated `.next/dev/types/routes.d.ts`, including an unterminated string literal and repeated syntax errors.
- A passing Next.js production build does not satisfy the separately locked typecheck gate.

**Gate impact:** blocks the required green typecheck/build/test baseline.

### 2. Critical configured workflows are failing

- `auth-tests`: 2 of 26 tests passed and 24 failed. Auth API requests returned `404` instead of their expected success or authorization responses.
- `approval-link-tests`: failed because setup and cleanup use unscoped database access; dependent tests were cancelled.
- `admin-notification-tests`: server readiness at `http://localhost:5000` timed out; 0 tests passed.
- `budget-stop-tests`: 2 of 3 tests passed; cleanup failed because `provider_usage_ledger` still referenced the temporary team.

These failures may include harness and environment defects, but the launch checklist requires reproducible passing evidence. Unreliable tests cannot be counted as proof that the underlying flows work.

**Gate impact:** blocks auth, admin, approval, notification, and credit-integrity certification.

### 3. Canonical campaign attribution is incomplete

The combined campaign suite passed 28 of 29 tests. The failing test was:

> `every campaign-derived deliverable threads canonical campaign context`

The failure identifies `lib/social-worker.ts` as missing the required canonical campaign-context behavior.

**Gate impact:** blocks complete campaign traceability and attribution certification.

### 4. Campaign export and approval ownership are not enforced end to end

Independent architect review found:

- `app/api/campaigns/[id]/export/route.ts` permits a team member to export a nonempty campaign without enforcing lifecycle status, client approval, policy approval, and agency-owner authorization.
- In the Ads approval path, only final export approval is role-restricted. An ordinary team member can record the client and policy prerequisite approvals.

This allows a single actor to self-approve prerequisites that the locked blueprint assigns to distinct parties.

**Gate impact:** blocks approval governance, export governance, and authorization certification.

### 5. Provider accounting coverage is incomplete

`tests/provider-accounting-boundary.test.ts` passed 8 of 9 tests. The failing boundary is:

> `lib/incident-intelligence/ai-analysis.ts:94: direct provider submission has no adjacent accounting`

The OpenAI incident-analysis invocation is outside the required immutable provider-accounting boundary. The admin cost-telemetry path also reports margin certification as unavailable, and the required reconciled trailing-30-day p90/sample/invoice evidence is absent.

**Gate impact:** blocks provider COGS completeness and margin certification.

### 6. Dependency security policy is not satisfied

The dependency audit reported:

- Critical: 0
- High: 51
- Moderate: 45
- Low: 10

All 51 high findings report an available fix. Notable affected packages include:

- `next@16.1.6`: App Router middleware/proxy bypass advisories.
- `drizzle-orm@0.39.1`: improperly escaped SQL-identifier injection advisory.
- `form-data@2.5.5`: multipart CRLF injection advisory.
- `flatted@3.3.3`: prototype pollution and denial-of-service advisories.
- Multiple `minimatch` and `brace-expansion` versions: ReDoS or resource-exhaustion advisories.

Reachability varies and must be assessed during remediation, but unresolved high-severity findings fail the locked security gate.

**Gate impact:** blocks dependency security certification.

### 7. Authenticated end-to-end journeys are not certified

The browser test verified public and unauthenticated behavior only. Account creation, authenticated agency work, client review, admin/billing, content generation, campaign review, export, and report delivery were not exercised end to end because the auth workflow is failing and paid-provider execution is unavailable.

**Gate impact:** blocks complete agency, client, admin, billing, and content-lifecycle certification.

### 8. Release-specific staging and recovery evidence is absent

The available readiness artifact is local-only, references an earlier commit, and does not certify `aa28026` for:

- Isolated staging migration and health.
- Provider-backed staging canary.
- Immutable cutover.
- Rollback and redeploy.
- Database and media restore.
- External alert delivery to the required recipient.

The latest known Gemini probe returns `429 RESOURCE_EXHAUSTED` because provider prepaid credit is depleted. `API_KEY_ENCRYPTION_SECRET` is also absent from secure configuration. Production remains on the legacy runtime and public health remains unavailable; it has not been switched to this candidate.

**Gate impact:** blocks operational launch and disaster-recovery certification.

## Security scanner triage

### SAST

The SAST scan reported 2 critical, 4 high, and 2 medium findings.

- The two critical SQL-injection alerts at `lib/db.ts` are false positives. `SET LOCAL ROLE citefi_tenant` is a fixed literal, and all contextual values use `$1`–`$4` parameters.
- The podcast/video route path-traversal alerts are likely false positives because filenames are sanitized or reduced with `path.basename` before joining fixed directories.
- `packages/apex-receiver/src/storage/localFilesystem.ts` needs manual defense-in-depth validation. Its reusable adapter joins caller-provided relative paths without an explicit resolved-path containment check. No externally reachable untrusted caller was demonstrated in this review.

These SAST alerts do not add a confirmed critical exploit to the verdict, but the shared storage adapter must be reviewed before exposing it to untrusted callers.

### HoundDog privacy/dataflow

HoundDog reported 2 critical, 4 medium, and 15 low findings.

The two critical API-key logging findings are false positives. `lib/ai-config.ts` logs only fixed `set` or `MISSING` status text and does not emit secret values.

### Confirmed security blocker

The confirmed security blocker from code review is the campaign export/approval authorization design described above. The dependency high findings are also unresolved release-policy blockers.

## Passing evidence

The following evidence passed and should be retained for the next certification:

| Area | Result |
|---|---|
| Production build | `npm run build` passed |
| Clean local release validation | `npm run validate:release` passed after removing runtime-added Redis port drift |
| Deployment contract and local readiness tests | Passed |
| Tenant RLS | 6/6 passed, including cross-team read/write denial, pooled-context reset, worker scoping, and client-reviewer column restrictions |
| Agency report boundaries | 11/11 passed, including approved-only client reads, private snapshot stripping, deterministic hashing, and database-enforced isolation |
| Provider accounting boundary | 8/9 passed; one blocking gap remains |
| Campaign suite | 28/29 passed; one blocking canonical-context gap remains |
| Incident/process focused tests | 13/13 passed in prior release evidence |
| Public browser smoke | Homepage, pricing, login, signup, privacy, and terms rendered on desktop; homepage rendered responsively at 390px |
| Unauthenticated access control | `/dashboard` and `/admin` redirected to login; protected content was not exposed |
| Accessibility smoke | Public headings/landmarks and form labels present; login keyboard focus reachable |
| Repository identity | Local and remote GitHub `main` both resolve to `aa28026` |
| Backup evidence | Prior production backup was uploaded off-host and its read-back size/checksum matched |
| Independent monitoring | GitHub uptime monitor detected the production outage and opened an incident issue |

The browser emitted repeated non-blocking resource `404` messages and password autocomplete warnings. No public-page crash or visible 500 state occurred during the smoke test.

## Blueprint disposition

### Demonstrated

- Tenant-isolated campaign persistence and cross-team rejection.
- Client-safe and agency-private report separation.
- Deterministic Ads packaging concepts, UTM/policy controls, immutable manifests, and manual-upload governance.
- Export-only stance for Google/Meta pending external approval.
- Immutable release packaging and guarded host cutover design.
- Independent uptime detection and off-host backup evidence.

### Partially demonstrated

- Campaign creation and attribution: persistence and isolation pass, but social campaign context fails.
- Provider COGS: ledger controls are substantial, but one direct provider call escapes accounting and margin evidence is unavailable.
- Approval/export governance: structures exist, but distinct approval ownership is not enforced across every route.
- Accessibility: public smoke passed, but quantitative contrast and authenticated workflows are untested.

### Not demonstrated for this candidate

- Complete authenticated agency and client journeys.
- Admin and billing workflows.
- Paid generation canary.
- Release-specific staging migration, cutover, rollback, redeploy, and restore.
- Green typecheck and all critical configured workflows.
- Reconciled production margin evidence.

## Conditions for recertification

A fresh candidate may be submitted only after:

1. Typecheck and every critical configured workflow pass reproducibly.
2. Campaign export and prerequisite approvals enforce distinct server-side authorization and lifecycle gates, with negative tests.
3. Every campaign-derived deliverable, including social generation, carries canonical campaign context.
4. Every paid-provider invocation uses immutable accounting, and required margin evidence is available.
5. High-severity dependency findings are remediated or formally demonstrated unreachable under the locked exception process.
6. Authenticated agency, client-reviewer, admin/billing, campaign, content, review, export, and report journeys pass browser testing.
7. The secure encryption secret is registered through the approved secret flow.
8. Gemini or the approved provider can execute the staging canary without fallback or fake success.
9. The exact candidate completes isolated staging migration, immutable cutover, rollback, redeploy, database/media restore, monitoring, and alert-recipient drills.
10. Production remains unchanged until all gates pass and a new independent report says **LAUNCH-READY**.

## Final verdict

**NO-GO — release candidate `aa28026` is not launch-ready and must not be deployed to production.**