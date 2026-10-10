---
name: Publishing consent policy
description: Exact approval, legacy history, assignment and administrator authority decisions
---

Publishing consent is specific to the reviewed content, durable media bytes,
and destination account. Existing approved flags are historical evidence, not
permission to invent a reviewed asset/account snapshot.

**Why:** The master audit explicitly requires human review of the precise assets
and destination and prohibits new roles or inferred legacy consent.

**How to apply:** Fail closed on missing evidence or changed material inputs,
including before admission and delayed dispatch. Reuse existing Campaign Brand
snapshots; do not read a mutable team profile to reconstruct reviewed content.

Explicit client-team assignment takes precedence over owning-team authority.
There is no implicit administrator override of a client review. An owning-team
owner/admin must explicitly revoke/reassign and obtain a fresh exact review.
Current authority and the same membership incarnation are required at dispatch;
removing and re-adding a member must not revive their old consent.

**Why:** A parent administrator's operational access does not establish that they
represent the assigned human reviewer. Membership deletion/recreation can return
the same role while representing a different authorization grant.

**How to apply:** Preserve existing roles and make assignment changes visible
and audited. Do not infer a publisher's identity from a worker/system context.
The locked dispatch claim is the revocation boundary; do not promise recall of an
external request that was already claimed.

Approval evidence is not disposable operational logging. Missing evidence must
block publication rather than be synthesized from timestamps or status flags.

**Why:** Consent can outlive ordinary log retention, and historical approval
must remain distinguishable from a newly reviewed exact version.

**How to apply:** Exclude approval evidence from generic operational cleanup.
Keep account/privacy deletion behavior explicit and separately governed, and
never convert evidence removal into a grant.

Preview-copy orphan cleanup is not approved-evidence expiry or account erasure.
Unknown historical approval completeness must keep a team on hold, even if no
current database reference exists. Production removal requires a separately
authorized exact dry-run plan and a certified conditional-delete provider.

**Why:** Privacy erasure, old log pruning or a partial restore can remove the
only proof that bytes were once approved. Absence then cannot establish that a
copy was never approved. Database rollback also cannot undo object deletion.

**How to apply:** Require independent history/retention review before enabling
orphan cleanup; preserve all referenced versions regardless of job status.
Treat an intent without a completed deletion record as uncertain, not as a
successful cleanup or a reason to retry automatically.
