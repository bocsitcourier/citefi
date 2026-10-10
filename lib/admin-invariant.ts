import { count, and, eq, sql } from "drizzle-orm";
import { users } from "@/shared/schema";

// Every operation that can remove an active platform administrator takes this
// transaction-scoped lock before checking the invariant. The stable numeric key
// is local to Citefi's database and does not lock application rows by itself.
export async function lockPlatformAdminState(tx: any): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(2026090901)`);
}

// Team membership role changes/removals use a separate lock namespace, keyed
// by team. The lock serializes last-owner/admin checks for one team without
// blocking unrelated teams.
export async function lockTeamAdminMembershipState(
  tx: any,
  teamId: number,
): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(2026090902, ${teamId})`);
}

export async function countActivePlatformAdmins(tx: any): Promise<number> {
  const [result] = await tx
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
  return Number(result?.count ?? 0);
}