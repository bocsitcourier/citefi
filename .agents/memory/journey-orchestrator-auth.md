---
name: Journey Orchestrator Auth & Bootstrap Patterns
description: Auth, bootstrap atomicity, and db.execute patterns for journey orchestrator routes — T018
---

## requireTeamMember vs requireAdmin split

`requireTeamMember(req)` returns `{ userId, teamId, role }` where `role` is the caller's **team membership role** ("admin"/"member"), NOT global platform admin status. Do NOT use `role === "admin"` as a cross-team bypass.

**Correct cross-team admin elevation pattern** (same as intelligence/[teamId]/route.ts):
```typescript
const { teamId: authTeamId } = await requireTeamMember(req);
if (authTeamId !== requestedTeamId) {
  try { await requireAdmin(req); }
  catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); }
}
```

`requireAdmin(req)` re-fetches the user from DB and checks `user.role === "admin"` (global platform role).

**Why:** A team admin (role="admin") has admin rights only within their team. Using that role as a cross-team bypass is a broken-access-control vulnerability — any team admin could read/mutate any other team's data.

## Bootstrap atomicity with pg advisory lock

When self-bootstrapping a policy inside a transaction, do NOT call `createPolicy()` / `createArm()` helpers (they hardcode the global `db` client). Inline the inserts using the `tx` connection:

```typescript
const txDb = getTxDb();
return txDb.transaction(async (tx) => {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${teamId}::int, ${lockKey}::int)`);
  // re-check after lock...
  const [policy] = await tx.insert(decisionPolicies).values({...}).returning();
  await tx.insert(decisionArms).values({...});
});
```

Advisory lock key pattern: `pg_advisory_xact_lock(teamId::int, contentTypeKey::int)` where contentTypeKey=1 for article, 2 for social_post.

If an active no-arm policy already exists after lock acquisition, deactivate it (`UPDATE active=false`) before creating a fresh one.

## db.execute dual-driver row access

Neon HTTP driver returns `{ rows: [...] }`. Plain pg Pool may return an array directly. Use:
```typescript
const row = ((result as any).rows ?? result as any[])[0] ?? {};
```

## visitorHash consistency

`hashVisitor` is internal to `bayesian-decision-service.ts` (not exported). Any service that needs to look up holdout_assignments by visitor must replicate:
```typescript
import { createHash } from "crypto";
function hashVisitor(visitorId: string): string {
  return createHash("sha256").update(visitorId).digest("hex").slice(0, 64);
}
```

## policyId ownership check in cross-entity mutation

Before calling `recordOutcome(policyId, ...)`, verify ownership:
```typescript
const policyRows = await db.select().from(decisionPolicies)
  .where(and(eq(decisionPolicies.id, policyId), eq(decisionPolicies.teamId, teamId)));
if (!policyRows[0]) throw Object.assign(new Error("Policy not found or access denied"), { status: 404 });
```

This prevents policy IDOR even when a caller submits a valid teamId but a foreign policyId.
