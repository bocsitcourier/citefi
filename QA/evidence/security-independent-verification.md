# Independent security verification

Status: independent offline verification completed with one concrete residual
finding. No production implementation was changed during this review. The
tests use `QA/support/offline-guard.mjs`; no database, external network,
provider, browser, workflow, or application service was used.

## Results

All executed commands returned exit code `0`. Counts below are taken from the
raw TAP files, not from the fixers' evidence.

| Area | Tests | Passed | Failed | Cancelled | Blocked | Raw TAP |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Original password-policy regression | 1 | 1 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-original-password-regression.tap` |
| Original mapped-loopback SSRF regression | 1 | 1 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-original-ssrf-regression.tap` |
| Auth/CSRF regressions plus API-boundary cases | 11 | 11 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-auth-targeted.tap` |
| Reset route boundary stubs | 3 | 3 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-password-route.tap` |
| Existing auth, recovery, preview, and browser-CSRF contracts | 6 | 6 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-existing-auth-security.tap` |
| DNS-pinned helper and three-sink contract coverage | 13 | 13 | 0 | 0 | 0 | `QA/evidence/runs/security-independent-ssrf-helper.tap` |

The 13 helper tests include the existing behaviors and the newly added
independent coverage in
`tests/security/url-validation-independent.test.ts`. The new coverage checks:

- IPv4-mapped and IPv4-compatible IPv6, loopback, RFC1918, CGNAT, link-local,
  multicast, documentation, and reserved address classes;
- public literal and DNS-host acceptance;
- `lookup({ all: true, verbatim: true })` behavior and rejection of any
  private answer before transport;
- private literal redirects, DNS-rebound redirects, public redirected hops,
  and HTTPS-to-HTTP downgrade rejection;
- declared and streamed response byte limits and transport hop timeouts; and
- caller-specific bounded helper options for media import, site crawling, and
  video style analysis.

The auth run independently rechecked the retained red regressions, both CSRF
layers, signed double-submit proofs, forwarded-host rejection, configured
preview origins, bearer API delegation, and the explicit reset capability
path. The route-boundary run independently checked that weak reset passwords
are rejected before hashing or mutation, malformed input retains the required
fields contract, and a strong policy-valid password reaches the stubbed
transaction. Preview fallback and client CSRF contracts also passed.

## Exact commands

Each command below was run with the output redirected to the corresponding raw
TAP path in the table above. `DATABASE_URL` and `NEON_DATABASE_URL` were
removed, and the offline guard was loaded for every command.

```text
env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/auth/password-reset-token-policy-regression.test.mjs > QA/evidence/runs/security-independent-original-password-regression.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-original-password-regression.tap; exit "$code"

env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/security/url-validation-ssrf-regression.test.mjs > QA/evidence/runs/security-independent-original-ssrf-regression.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-original-ssrf-regression.tap; exit "$code"

env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/auth/password-reset-token-policy-regression.test.mjs tests/auth/csrf.test.ts > QA/evidence/runs/security-independent-auth-targeted.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-auth-targeted.tap; exit "$code"

env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --experimental-loader ./tests/scope-0-alias-loader.mjs --experimental-test-module-mocks --import tsx/esm --test tests/auth/password-reset-token-route.test.ts > QA/evidence/runs/security-independent-password-route.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-password-route.tap; exit "$code"

env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/auth/password-recovery-security.test.ts tests/auth/preview-session-fallback.test.ts tests/security/client-csrf-fetch-contract.test.ts > QA/evidence/runs/security-independent-existing-auth-security.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-existing-auth-security.tap; exit "$code"

env -u DATABASE_URL -u NEON_DATABASE_URL node --import ./QA/support/offline-guard.mjs --import tsx/esm --test tests/security/url-validation-independent.test.ts > QA/evidence/runs/security-independent-ssrf-helper.tap 2>&1; code=$?; printf 'EXIT_CODE=%s\n' "$code" >> QA/evidence/runs/security-independent-ssrf-helper.tap; exit "$code"
```

## Concrete residual bug

`safeFetchWithRedirects` starts `dns.promises.lookup` before it creates the
request and its `req.setTimeout` timer. The independent test
`reproduces an unbounded DNS wait outside the transport timeout` holds DNS
resolution open with a five-millisecond caller timeout; the fetch remains
pending past a 25-millisecond test deadline and only completes when the DNS
fixture is manually released. This is a real application-level timeout gap,
not a failed test.

Because media import, site crawling, and video style analysis all use the
shared helper, the gap affects all three sinks. The transport timeout and
response byte limits passed once a request existed, but DNS resolution itself
is not bounded by those options. Fixers should add a bounded DNS-resolution
deadline (and preserve cancellation/cleanup) before this SSRF work can be
considered fully verified.

No other concrete security bug was reproduced in the tested scope.

## Existing HoundDog finding triage

Dependency and SAST scan results were not rerun. The following triage uses
only the callback-safe summary in `QA/evidence/callback-scan-evidence.md` and
current source inspection; scanner payloads and full messages were not
retained.

| Finding | Assessment | Risk / minimal remediation |
| --- | --- | --- |
| `lib/article-critique.ts` — LOW `BUDGET` | Intended processing. The module sends article text and SEO inputs to the configured provider for critique and refinement; budget-like values can be part of that user content. No separate budget record or secret logging path was found. | Low additional privacy risk in this workflow. Continue provider/data notice and avoid adding prompt or raw-content logging. |
| `lib/gemini.ts` — MEDIUM `INCOME` | Intended aggregate local-SEO processing. `medianIncome` is read from batch SEO location intelligence and placed in an article-generation prompt as an aggregate demographic signal, not an identified person's income. | Medium scanner severity is conservatively reasonable for financial attributes. Prefer aggregate/coarsened values and exclude any future person-level income fields before provider submission. |
| `lib/gemini-social.ts` — LOW `PHYSICAL-ADDRESS` | Partly intended, but actionable exposure risk. Local SEO prompts intentionally include location, ZIPs, neighborhoods, landmarks, and testimonial location. The `location` input is free-form, so a caller could supply a street address even though normal product use is city/region targeting. | Avoidable if the boundary normalizes to city/region/ZIP and rejects or strips street-level address components before provider calls. Do not pass testimonial or user-entered full addresses unless explicitly required and disclosed. |
| `scripts/setup-live-generation-fixture.ts` — LOW `EMAIL` | Intended test-only fixture identity. The address uses the reserved `.invalid` domain and is used to seed an isolated QA user; it is not a production account or customer address. | Low production privacy risk. Keep fixture-only execution and local credential permissions; optionally generate a per-run `.invalid` address to remove the static scanner signal. |

These are privacy-risk triage decisions, not a replacement scan and not a
claim that providers retain or misuse the values.

## Non-certification boundaries

This evidence does **not** certify:

- a deployed service, real DNS resolver behavior, edge proxy header
  normalization, browser cookie behavior, or live redirect destinations;
- database authorization, tenant isolation, admin role re-fetching, or
  account takeover resistance against a live database;
- end-to-end email delivery, reset-link delivery, provider behavior, media
  processing, FFmpeg behavior, or real content-size enforcement at a running
  route; or
- dependency, SAST, or HoundDog scan freshness beyond the existing callback-safe
  summary.

All observations are limited to source inspection, mocked DNS/transport,
offline route-boundary stubs, and static contract checks. The residual DNS
timeout finding must be addressed and retested by the implementation owners.