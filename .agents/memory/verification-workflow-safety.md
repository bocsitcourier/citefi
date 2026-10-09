---
name: Verification workflow safety
description: Rationale for conservative regression contracts around verification-only deployment runs.
---

Use an explicit reviewed allowlist for pin-only jobs and commands; reject unknown jobs and job-condition expressions until their safety is deliberately incorporated into the contract.

**Why:** A keyword scan cannot establish that a newly added script, action, reusable workflow, or job will not load credentials, deploy, or migrate. Rejecting unchecked additions is intentional, even when an addition appears harmless.

**How to apply:** When extending deployment workflows, update the offline safety contract consciously and retain negative tests for skipped/failed dependencies and verification-only runs. Execute pin-verification commands against synthetic offline scan fixtures, never production credentials.

Keep pre-merge gate verification separate from production verification and the broader host-release suite.

**Why:** Pull requests must be safe to test without production credentials, generated private keys, application lifecycle hooks or release operations. The broader release contract also checks unrelated runtime configuration; it is not a substitute for a narrowly scoped, credential-free workflow gate check.

**How to apply:** Use only the YAML parser and synthetic scan fixtures for PR gate checks, and retain mutation coverage for both the deployment gates and the CI safety boundary.
