---
name: Required deployment check
description: Why merge enforcement requires unfiltered checks and PR-based synchronization.
---

Keep required-check workflows free of workflow-level path/branch filters and
job-level skip conditions, and preserve the required job name and expected
GitHub Actions source.

**Why:** GitHub leaves workflow-filtered checks pending on unrelated pull
requests. A skipped job can instead be accepted without executing its checks.
Local tests cannot prove that repository enforcement actually exists.

**How to apply:** Verify live ruleset enforcement as well as the offline contract.
If introducing a merge queue, support and verify its merge-group event first.

Treat omitted GitHub `bypass_actors` as unverifiable, never as an empty list.
Use effective branch rules to determine applicability, then inspect their
rulesets, including inherited rules.

**Why:** GitHub omits bypass actors unless the calling identity has write
visibility to the ruleset. A successful public or read-only API response
therefore cannot by itself prove that administrators cannot bypass protection.
The effective endpoint also intentionally omits disabled/evaluate rules.

**How to apply:** Keep the auditor GET-only even when its dedicated identity
needs broader visibility. Report missing visibility as a failure to verify,
and never reuse deployment credentials or automatically repair repository rules.

Use branch-and-pull-request synchronization; do not restore direct main-branch
force updates by adding bypass actors or disabling required checks.

**Why:** The requested merge protection deliberately prevents updates that have
not passed the safety check, including administrator direct-sync operations.

**How to apply:** Account for this when maintaining GitHub synchronization tooling.
Publish prerequisite workflow files before expecting required checks on existing PRs.

For isolated npm configuration, use two distinct empty files for user and
global configuration, not `/dev/null` for both.

**Why:** GitHub's npm rejects loading one path into both configuration layers,
even though the test command may succeed locally without exercising installation.

**How to apply:** Verify the actual hosted workflow at least once when setting
up required checks rather than relying solely on the local contract.
