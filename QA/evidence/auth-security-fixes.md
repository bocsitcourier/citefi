# Auth security fixes — SEC-P2-001 and SEC-P2-003

Status: implementation and offline regression evidence only. This record is
not an independent security certification; stop here for independent tester
review.

## Exact root causes fixed

### SEC-P2-001 — token reset password policy

`app/api/auth/reset-password-token/route.ts` previously enforced only a
minimum length before hashing and entering the reset transaction. That let a
valid reset-link holder install a password that the shared signup/change/reset
policy would reject. The route now:

- rejects non-string or missing token/password values with the existing
  required-fields `400` response;
- calls the existing `validatePassword(newPassword)` before password hashing,
  token hashing, or the reset transaction; and
- returns a `400` security-requirements response for a policy failure.

### SEC-P2-003 — cookie CSRF origin authority

Both CSRF layers (`lib/csrf.ts` and `proxy.ts`) previously derived an
allowlisted origin from request `Host`/`X-Forwarded-Host` and
`X-Forwarded-Proto`. A spoofed forwarded authority could therefore make an
attacker origin appear allowed. Both layers now trust only:

- the origin authority from the request URL;
- configured `APP_URL` and `NEXT_PUBLIC_APP_URL`; and
- every configured Replit preview domain from `REPLIT_DEV_DOMAIN` and
  comma-separated `REPLIT_DOMAINS`.

Bearer authentication, capability-token paths, preview page fallback, signed
CSRF token verification, and the admin page gate were not changed.

## Regression tests and evidence

The pre-fix failures remain retained in the original red logs:

- `QA/evidence/runs/password-reset-token-policy-regression.txt`
  (`1` test, `0` pass, `1` fail);
- `QA/evidence/runs/auth-csrf.txt`
  (`5` tests, `4` pass, `1` fail for forwarded-host spoofing).

Targeted offline green execution:

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/auth/password-reset-token-policy-regression.test.mjs tests/auth/csrf.test.ts
```

Result: `9` tests passed, `0` failed. Full output:
`QA/evidence/runs/auth-security-targeted-green.txt`.

The route-level boundary regressions use module-boundary stubs and the
offline guard:

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test tests/auth/password-reset-token-route.test.ts
```

They verify that a weak password causes no stub hash or transaction/update,
non-string input preserves the required-fields error contract without policy,
hash, or database calls, and a policy-verified strong password reaches the
stub hash and transaction. Result: `3` tests passed, `0` failed. Full output:
`QA/evidence/runs/password-reset-token-route-green.txt`.

CSRF regressions cover both layers: each rejects an evil `Origin` paired with
an attacker-controlled forwarded host, and each accepts a configured
multi-domain Replit preview origin. The existing bearer-shaped-header and
signed-token cases also remain passing.

## Fixed scope and risk qualifiers

Fixed production scope is limited to the token-reset route, shared CSRF
helper, and Next.js proxy CSRF origin handling, plus their offline regression
tests. SEC-P2-002 SSRF work was not touched.

These tests are source/helper and stubbed route-boundary evidence only. They
do **not** establish account takeover, a proven browser CSRF exploit, live
database behavior, deployment-edge header normalization, provider behavior,
or end-to-end email/reset-link delivery. An independent tester must review
the changes and determine any remaining deployment-specific risk.