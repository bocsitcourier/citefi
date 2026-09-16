# Phase 2 security execution evidence

This record covers the owned Phase 2 QA/security scope: `tests/auth/*`,
`tests/security/*`, `tests/admin/*`, and auth/authz/CSRF/tenant/admin/upload
security surfaces.

## Safety controls

- Node: v20.20.0.
- Every Node test command preloaded `./QA/support/offline-guard.mjs`.
- TypeScript tests used `--import tsx/esm`.
- Commands explicitly unset `DATABASE_URL` and `NEON_DATABASE_URL`; no
  `.env`, `.env.local`, or package test script that loads dotenv was used.
- No workflow restart, package installation, app service, port 5000/6379
  access, provider call, real email, customer-data write, or secret output was
  performed.
- Scanner callbacks were invoked through the approved security-scan skill
  callbacks. Full scanner payloads and messages were not retained.

## Existing safe offline test execution

Command form:

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test <test-file>
```

| Test command / file | Exit | Counts | Result |
|---|---:|---|---|
| `tests/auth/csrf.test.ts` | 1 | 5 total; 4 pass, 1 fail | Existing four cases pass. The added forwarded-host regression fails as expected for SEC-P2-003. Output: `QA/evidence/runs/auth-csrf.txt`. |
| Existing CSRF cases selected by `--test-name-pattern` | 0 | 4 pass, 1 skipped | Existing CSRF behavior passes without counting the new regression. Output: `QA/evidence/runs/auth-csrf-existing-only.txt`. |
| `tests/auth/password-recovery-security.test.ts` + `tests/auth/preview-session-fallback.test.ts` | 0 | 3 pass, 0 fail | Pass. Output: `QA/evidence/runs/auth-static.txt`. |
| `tests/security/client-csrf-fetch-contract.test.ts` | 0 | 3 pass, 0 fail | Pass. Output: `QA/evidence/runs/security-client-csrf.txt`. |

## New minimal regression execution

These are offline source/helper regressions added only after reproducing the
current behavior:

| Regression | Exit | Counts | Reproduction |
|---|---:|---|---|
| `tests/auth/password-reset-token-policy-regression.test.mjs` | 1 | 1 total; 0 pass, 1 fail | Route lacks the shared `validatePassword` import/call. Output: `QA/evidence/runs/password-reset-token-policy-regression.txt`. |
| `tests/security/url-validation-ssrf-regression.test.mjs` | 1 | 1 total; 0 pass, 1 fail | IPv4-mapped loopback URL is accepted by `validateExternalUrl`. Output: `QA/evidence/runs/url-validation-ssrf-regression.txt`. |

These static/helper results confirm current code behavior only; they are not
full route, database, storage, network, or live-feature verification.

## Existing suites blocked by the safe-offline guard

Each file below was attempted with the same runner, individually, with an
outer 12-second timeout where applicable. All stopped while importing
`lib/db.ts`, which requires `DATABASE_URL`; no test body or app database ran.

| File | Exit | Classification | Output |
|---|---:|---|---|
| `tests/auth/auth-api.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/auth-api.txt` |
| `tests/auth/invite-concurrency.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/invite-concurrency.txt` |
| `tests/security/tenant-rls.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/tenant-rls.txt` |
| `tests/security/conversion-webhook.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/conversion-webhook.txt` |
| `tests/admin/admin-approval.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/admin-approval.txt` |
| `tests/admin/admin-notifications.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/admin-notifications.txt` |
| `tests/admin/email-review-link.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/email-review-link.txt` |
| `tests/admin/email-unit.test.ts` | 1 | `BLOCKED_BY_GUARD` / missing safe offline DB fixture | `QA/evidence/runs/email-unit.txt` |

## Approved scanner callbacks

| Scanner callback | Status | Result |
|---|---|---|
| `runDependencyAudit()` | OK | 0 vulnerabilities; severity metadata all zero. |
| `runSastScan()` | OK | 0 findings. |
| `runHoundDogScan()` | OK | 4 static privacy findings: 1 medium and 3 low. |

Sanitized scanner evidence, paths, rule IDs, and privacy-finding counts are in
`QA/evidence/callback-scan-evidence.md`; scanner payloads, messages,
fingerprints, and secret-like values were excluded.

## Findings and risk classification

Current confirmed findings, historical/source-only observations, and
scope-blocked coverage are separated in
`tests/findings/security-phase2-findings.md`.
