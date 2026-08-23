---
name: PostgreSQL tenant RLS
description: Durable rules for making PostgreSQL RLS an authoritative tenant boundary.
---

Tenant-scoped database work must run as the constrained tenant role inside a
transaction on one checked-out connection. This includes legacy interactive
transaction helpers: they must delegate to the tenant-aware transaction path
rather than exposing the privileged login role.

**Why:** The system login role intentionally has `BYPASSRLS` for migrations and
maintenance. `FORCE ROW LEVEL SECURITY` does not protect tenant code that
continues executing as that role.

**How to apply:** When adding any pooled or transactional database API, make it
read the validated async tenant context, then use `BEGIN`, `SET LOCAL ROLE`, and
transaction-local identity settings before executing tenant statements.

Unscoped application database access must fail closed. Bootstrap, maintenance,
webhook, and identity-lifecycle operations use a visibly named privileged
client or a system context with a concrete audit reason.

**Why:** Treating an absent async context as system access lets an omitted auth
or worker wrapper silently bypass the entire RLS boundary.

**How to apply:** Keep the default database exports context-enforced. Make every
privileged call site self-identifying, and test that a bare query and legacy
transaction accessor both reject when no context exists.

Never establish system context as a module- or process-wide default, especially
in worker processes. Bound it to one bootstrap, monitor, or maintenance
invocation; tenant jobs must carry and validate their positive team identity.

**Why:** AsyncLocalStorage state is inherited by timers, listeners, and worker
callbacks created beneath it. A process-level system scope turns any omitted
worker wrapper into a silent RLS bypass.

**How to apply:** Use a visibly named privileged client for inherently
cross-tenant queries, `runWithSystemContext()` for bounded system service calls,
and `runWithTenantContext()` once a scheduler or recovery path has claimed an
authoritative team.

Pipeline failure policy must run in the same validated tenant context as the
processor, including billing metadata lookup and final reservation release.

**Why:** AsyncLocalStorage restores the caller after a scoped processor rejects;
an outer catch otherwise runs unscoped, causing fail-closed billing calls to be
silently rejected and reservations to remain stranded.

**How to apply:** Save the validated worker tenant before invoking the
processor, then re-enter it around failure classification and cleanup. Legacy
payload owner lookup may use one audited system scope, but must switch to the
resolved tenant before processing; test final release from a blocked caller
with the real database path.

Tenant-owned telemetry written deep in a provider call graph must derive its
team from the validated execution context and reject conflicting caller input.

**Why:** Optional telemetry context is frequently incomplete. Writing a null
team under RLS is rejected and silently makes per-run budget checks see zero
spend; trusting a supplied different team would risk cross-tenant attribution.

**How to apply:** Resolve the effective telemetry team at the single persistence
boundary, preserve ambient run attribution, and integration-test that an
omitted-team provider write is persisted and trips the same tenant's budget.

Personal account deletion must not cancel or mutate a shared team's billing.

**Why:** Team membership alone is not billing authority; otherwise an ordinary
member deleting their own account could cancel service for every teammate.

**How to apply:** Keep self-service deletion limited to the authenticated
identity and its dependent rows. Team subscription cancellation belongs in a
separate owner-authorized team lifecycle flow.

RLS policies on identity/hierarchy tables must not query those same protected
tables directly. Put membership and hierarchy checks in tightly scoped
`SECURITY DEFINER` helpers with a fixed safe search path and row security
disabled.

**Why:** Self-referential policy subqueries can recurse during PostgreSQL query
rewriting and fail every access with an infinite-recursion error.

**How to apply:** Revalidate current membership and active-team status in the
helper, grant helper execution only to the tenant role, and adversarially test
the policy through the real role.

RLS is a row boundary, not a column boundary. A narrowly authorized write to a
shared table needs an additional database-enforced column guard.

**Why:** An UPDATE policy that selects only assigned rows still allows every
granted column on those rows to be changed.

**How to apply:** Use a trigger, restricted view/function, or column-level grant
to allowlist writable fields, and make state checks null-safe because SQL
`NULL NOT IN (...)` does not evaluate to true.

Signed external callbacks that need a tenant secret must cross the boundary in
two stages: bounded system lookup and signature verification first, then tenant
context for every attribution, ownership, and write query.

**Why:** An unauthenticated callback cannot enter tenant context until durable
ownership is resolved and authenticated, but leaving its post-verification work
privileged either bypasses RLS or makes the fail-closed default DB reject valid
production callbacks.

**How to apply:** Use the privileged client only for the minimum owner/secret
resolution, verify the raw signed payload, enter the resolved active tenant, and
re-check content ownership under RLS before writing. Test a valid signature for
one tenant against another tenant's content.

RLS rollout must fail atomically unless the deployment login can actually assume
the constrained tenant role.

**Why:** Suppressing a failed role grant lets `FORCE ROW LEVEL SECURITY` commit
even though every runtime tenant query will later fail at `SET LOCAL ROLE`.

**How to apply:** Keep the grant inside the migration transaction, verify role
membership, and exercise `SET LOCAL ROLE` before any forced-RLS policy can
commit. Never treat insufficient role-grant privilege as an idempotent warning.