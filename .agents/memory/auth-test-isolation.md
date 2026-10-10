---
name: Authentication test isolation
description: Why routine authentication tests must use disposable fixtures rather than application configuration.
---

Routine auth/admin tests must use owned disposable fixtures, never application
environment files or an already-running preview server.

**Why:** Older test instructions coupled destructive seed/cleanup operations to
application credentials. A missing local server could also redirect tests toward
the shared application's database. Module initialization needs synthetic values,
not real credentials.

**How to apply:** Use the checked-in test scripts and isolation support docs.
Preserve real authorization and MFA assertions when adapting fixtures. Direct
route-handler HTTP fixtures intentionally avoid Next dev startup and its
application configuration/worker side effects; they are not full-stack browser
coverage.

Keep rate-limit probes separate from normal authentication traffic.

**Why:** Shared synthetic IPs can exhaust the rate limiter before ordinary login
assertions, producing misleading authorization failures.

**How to apply:** Assign distinct TEST-NET ranges to limit-exhaustion probes and
normal requests. Never disable the production rate limiter to make tests pass.