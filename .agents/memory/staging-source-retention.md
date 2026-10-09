---
name: Staging source retention boundaries
description: Operational safety and evidence boundaries for publishing QA snapshots.
---

Keep the full symlink dependency graph of every retained staging snapshot, not
only the final realpath of the active release's dependencies. Cleanup must be an
explicit, separately reviewed preview/digest operation; low disk space blocks
setup rather than granting deletion authority.

**Why:** Publishing QA reuses older dependency trees through chained links.
Age-only or final-target-only cleanup can break the live app. Private evidence
and retained synthetic media were intentionally retained under the authorized
acceptance scope and are not implicitly authorized for deletion.

**How to apply:** Preserve intermediate source targets and all runtime references.
Treat legacy media without a frozen source inventory conservatively. Keep this
scope separate from production releases, object storage, and GitHub recovery.
