# Phase 2 security findings

Status: current findings recorded before implementation. This verifier added
minimal failing regressions for the three reproducible defects below; no
production implementation changes were made in this phase.

## Current confirmed findings

| ID | Severity | Area | Current evidence | Risk boundary |
|---|---|---|---|---|
| SEC-P2-001 | Medium | Password reset policy | `app/api/auth/reset-password-token/route.ts` checks only `newPassword.length < 8` before hashing and applying a valid reset token. The offline regression `tests/auth/password-reset-token-policy-regression.test.mjs` fails because the route neither imports nor invokes the shared `validatePassword` policy. | A holder of a valid reset link can choose a password that the normal password policy rejects. This is a source-confirmed policy bypass; no database or email flow was exercised. |
| SEC-P2-002 | High | SSRF URL validation | `lib/url-validation.ts` allows `http://[::ffff:127.0.0.1]/`; the offline regression `tests/security/url-validation-ssrf-regression.test.mjs` fails with “Missing expected exception.” `app/api/media/from-url/route.ts` calls this validator and then passes the URL to `fetch`. | The validator can be bypassed with an IPv4-mapped loopback literal. End-to-end network exploitation was intentionally not attempted under the offline guard. |
| SEC-P2-003 | Medium (deployment-dependent) | Cookie CSRF origin allowlist | `lib/csrf.ts` adds the request's `x-forwarded-host` directly to the allowed-origin set. The added case in `tests/auth/csrf.test.ts` supplies `Origin: https://evil.example` and `X-Forwarded-Host: evil.example` and unexpectedly passes; the test fails with “Missing expected exception.” | If the deployment edge does not overwrite this header, an attacker-controlled forwarded-host value can make a cross-origin cookie mutation satisfy the origin check. The finding is source-confirmed and directly reproduced in the helper; production-proxy header normalization was not tested. |

The regression failures are intentionally retained as pre-fix evidence. They
are not application test-suite pass claims.

## Existing coverage that passed offline

- `tests/auth/password-recovery-security.test.ts` and
  `tests/auth/preview-session-fallback.test.ts`: 3 tests passed.
- `tests/security/client-csrf-fetch-contract.test.ts`: 3 tests passed.
- Existing CSRF cases in `tests/auth/csrf.test.ts`: 4 passed; the newly added
  forwarded-host case failed as described above.

The tests were run with `QA/support/offline-guard.mjs`, with database
environment variables removed and without loading dotenv files. They used no
external providers, email delivery, app services, or customer-data writes.

## Guard-blocked coverage

The following existing suites were attempted individually under the same
offline runner and stopped during import because `DATABASE_URL` was unset:

- `tests/auth/auth-api.test.ts`
- `tests/auth/invite-concurrency.test.ts`
- `tests/security/tenant-rls.test.ts`
- `tests/security/conversion-webhook.test.ts`
- `tests/admin/admin-approval.test.ts`
- `tests/admin/admin-notifications.test.ts`
- `tests/admin/email-review-link.test.ts`
- `tests/admin/email-unit.test.ts`

These are `BLOCKED_BY_GUARD`/safe-offline setup results, not application
failures and not pass claims. Admin/auth seed scripts were not executed because
they are database-writing fixtures.

## Scanner-only results

The approved callbacks reported:

- Dependency audit: 0 vulnerabilities.
- SAST: 0 findings.
- HoundDog: 4 static privacy findings (1 medium, 3 low), in
  `lib/gemini.ts`, `lib/gemini-social.ts`, `lib/article-critique.ts`, and
  `scripts/setup-live-generation-fixture.ts`.

Those HoundDog paths and rule IDs are recorded in
`QA/evidence/callback-scan-evidence.md`. They are scanner-only static results,
outside the owned Phase 2 auth/authz/CSRF/tenant/admin/upload implementation
scope, and were not promoted to current owned-scope defects.

## Historical or unconfirmed risk separation

- The discovery record identified a development-only `/admin` page-navigation
  bypass in `proxy.ts`. It remains a documented preview behavior in the
  current source, while API handlers remain the authoritative authorization
  boundary. No API privilege escalation was reproduced, so it remains a
  historical/source observation rather than a new current finding here.
- Earlier upload review hypotheses about declared MIME type versus magic bytes
  and shared logo paths were not reported as defects. The media storage helper
  performs image-byte detection, and no safe end-to-end upload/public-object
  reproduction was available without storage services.
- Historical inventory statuses and prior “fixed” claims are not treated as
  current verification. Database-backed tenant, admin, invite, webhook, and
  email behavior remains unverified because the safe offline policy blocked
  those setups.
