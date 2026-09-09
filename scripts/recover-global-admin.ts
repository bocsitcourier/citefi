/**
 * Controlled one-time recovery for an existing global administrator.
 *
 * Required environment values:
 *   ADMIN_RECOVERY_EMAIL
 *   ADMIN_RECOVERY_PASSWORD
 *
 * Run:
 *   ADMIN_RECOVERY_CONFIRM=RESET_EXISTING_GLOBAL_ADMIN \
 *   node --env-file=.env.local --import tsx/esm scripts/recover-global-admin.ts
 */
import { and, eq } from "drizzle-orm";
import { getTxDb } from "../lib/db";
import { hashPassword, validatePassword } from "../lib/auth";
import { activityLogs, sessions, users } from "../shared/schema";
import { enterSystemContext } from "../lib/tenant-context";

async function main() {
  if (process.env.ADMIN_RECOVERY_CONFIRM !== "RESET_EXISTING_GLOBAL_ADMIN") {
    throw new Error("Recovery confirmation is missing");
  }

  const email = process.env.ADMIN_RECOVERY_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_RECOVERY_PASSWORD;
  if (!email || !password) {
    throw new Error("ADMIN_RECOVERY_EMAIL and ADMIN_RECOVERY_PASSWORD are required");
  }

  const validation = validatePassword(password);
  if (!validation.isValid) {
    throw new Error(`Recovery password is invalid: ${validation.errors.join(". ")}`);
  }

  enterSystemContext("controlled global administrator credential recovery");
  const txDb = getTxDb();
  await txDb.transaction(async (tx) => {
    const [admin] = await tx
      .select({
        id: users.id,
        role: users.role,
        accountStatus: users.accountStatus,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .for("update");

    if (
      !admin ||
      admin.role !== "admin" ||
      admin.accountStatus !== "active" ||
      admin.deletedAt
    ) {
      throw new Error("No active global administrator matches the supplied email");
    }

    const passwordHash = await hashPassword(password);
    await tx
      .update(users)
      .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, admin.id));

    await tx
      .update(sessions)
      .set({
        isActive: 0,
        forceLogoutAt: new Date(),
        terminationReason: "Owner credential recovery",
      })
      .where(and(eq(sessions.userId, admin.id), eq(sessions.isActive, 1)));

    await tx.insert(activityLogs).values({
      userId: admin.id,
      action: "global_admin_credential_recovered",
      resource: "users",
      resourceId: admin.id,
      details: { method: "controlled_recovery_script", sessionsRevoked: true },
      severity: "warning",
    });
  });

  console.log("Global administrator access was recovered and existing sessions were revoked.");
}

main().catch((error) => {
  console.error("Global administrator recovery failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});