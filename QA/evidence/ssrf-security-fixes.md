# SEC-P2-002 SSRF fix evidence boundary

## Scope

This change centralizes server-side external URL validation and DNS-pinned,
manual-redirect fetching for the media URL import route, site crawler, and
video style analyzer. The existing brand-profile pinned fetch export remains
available through `lib/client-brand-profile-service.ts` for compatibility.

The trusted-address predicate rejects IPv4-mapped and IPv4-compatible IPv6,
loopback, RFC1918, CGNAT, link-local, multicast, documentation, benchmarking,
and other reserved IPv4/IPv6 ranges. DNS answers are resolved with
`all: true`; every answer must be public, and the selected answer is pinned
through Node's `lookup` callback for that request. Redirects are followed only
after validating and pinning the next hop, with HTTPS-to-HTTP downgrade
rejection.

Caller-specific protections remain at their boundaries:

- Media URL import: 30-second hop timeout, 50 MiB body limit, and existing
  image/audio/video type processing.
- Site crawler: 15-second hop timeout, 500,000-byte body limit, and existing
  HTML content-type and crawl limits.
- Video style analyzer: existing media content-type checks, 100 MiB direct
  video limit, bounded thumbnail/oEmbed responses, and existing FFmpeg path.

## Verification boundary

The intended offline regression coverage is:

- mapped IPv6 loopback, private, CGNAT, link-local, and reserved forms;
- legitimate public host/address acceptance;
- private redirect rejection before the second connection;
- DNS rebinding resistance and Node `lookup({ all: true })` callback shape;
- existing HTTPS downgrade policy;
- caller-specific binary response limits.

Tests should use mocked DNS/transport and local fixtures only. No external,
internal, provider, storage, database, or application-service request was
used to establish this evidence. This record describes the expected security
boundary and does **not** claim that an actual deployed service was exploited
or that live end-to-end traffic was verified.

Independent security testing is the next review gate.

## DNS-deadline follow-up

### Root cause

The first pinned-fetch implementation started `dns.promises.lookup()` before
creating the transport request. Its `req.setTimeout()` therefore did not exist
while DNS was pending, so a resolver that never settled could keep the whole
operation pending beyond the caller's timeout.

### Fix

`safeFetchWithRedirects` now creates a whole-operation deadline and abort signal
covering DNS resolution, every redirect hop, transport setup, and response
body consumption. DNS is raced against that signal with rejection handlers
attached to the underlying promise, so a late resolver completion cannot start
a transport request and cannot create an unchecked rejection. The existing
`timeoutMs` remains the per-hop request timeout; callers may provide
`deadlineMs` separately, and the backwards-compatible default bounds the whole
operation to `timeoutMs`. Request abort listeners are removed on every settled
path, and the deadline timer is cleared on completion.

### Actual offline green verification

With `DATABASE_URL` and `NEON_DATABASE_URL` unset and the offline guard loaded:

| Test | Result |
|---|---:|
| `tests/security/url-validation-independent.test.ts` | 13 passed, 0 failed |
| `tests/security/url-validation-ssrf-regression.test.mjs` | 1 passed, 0 failed |

The focused hanging-DNS acceptance case now asserts that the operation resolves
to `null` within the caller deadline and that no transport request starts after
DNS has expired. These are mocked DNS/transport fixtures only; this remains
offline source/helper verification and does not claim an exploited deployed
service or live internal/external traffic.