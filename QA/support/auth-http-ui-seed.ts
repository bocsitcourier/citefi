import { randomUUID } from "node:crypto";

export const AUTH_HTTP_UI_PASSWORD = "QA!Passw0rd#123";

export interface AuthHttpUiSeed {
  admin: { id: number; email: string; password: string };
  member: { id: number; email: string; password: string };
  mfaMember: { id: number; email: string; password: string };
  pending: { id: number; email: string; password: string };
}

export async function seedAuthHttpUiUsers(): Promise<AuthHttpUiSeed> {
  // These imports must remain dynamic: the caller starts the isolated
  // fixture first so lib/db and lib/auth see only fixture credentials.
  const db = await import("../../lib/db.js");
  const schema = await import("../../shared/schema.js");
  const auth = await import("../../lib/auth.js");
  const passwordHash = await auth.hashPassword(AUTH_HTTP_UI_PASSWORD);
  const prefix = `qa_auth_ui_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const insert = async (values: Record<string, unknown>) => {
    const [user] = await db.systemDb
      .insert(schema.users)
      .values({ ...values, passwordHash } as any)
      .returning({ id: schema.users.id, email: schema.users.email });
    if (!user) throw new Error("Auth HTTP UI fixture failed to seed a synthetic user");
    return { ...user, password: AUTH_HTTP_UI_PASSWORD };
  };

  return {
    admin: await insert({
      email: `${prefix}_admin@citefi.invalid`,
      fullName: "QA UI Admin",
      role: "admin",
      accountStatus: "active",
      mfaEnrollmentDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }),
    member: await insert({
      email: `${prefix}_member@citefi.invalid`,
      fullName: "QA UI Member",
      role: "team_member",
      accountStatus: "active",
    }),
    mfaMember: await insert({
      email: `${prefix}_mfa@citefi.invalid`,
      fullName: "QA UI MFA Member",
      role: "team_member",
      accountStatus: "active",
      twoFactorEnabled: 1,
      twoFactorMethod: "email",
    }),
    pending: await insert({
      email: `${prefix}_pending@citefi.invalid`,
      fullName: "QA UI Pending Member",
      role: "team_member",
      accountStatus: "pending_approval",
    }),
  };
}

export async function cleanupAuthHttpUiUsers(seed: AuthHttpUiSeed): Promise<void> {
  const db = await import("../../lib/db.js");
  const schema = await import("../../shared/schema.js");
  const { eq, inArray } = await import("drizzle-orm");
  const userIds = [seed.admin.id, seed.member.id, seed.mfaMember.id, seed.pending.id];

  await db.systemDb.delete(schema.notifications)
    .where(inArray(schema.notifications.entityId, userIds));
  await db.systemDb.delete(schema.sessions)
    .where(inArray(schema.sessions.userId, userIds));
  await db.systemDb.delete(schema.loginChallenges)
    .where(inArray(schema.loginChallenges.userId, userIds));
  await db.systemDb.delete(schema.emailVerificationCodes)
    .where(inArray(schema.emailVerificationCodes.userId, userIds));
  await db.systemDb.delete(schema.activityLogs)
    .where(inArray(schema.activityLogs.userId, userIds));
  await db.systemDb.delete(schema.adminActionLogs)
    .where(eq(schema.adminActionLogs.userId, seed.admin.id));
  await db.systemDb.delete(schema.users)
    .where(inArray(schema.users.id, userIds));
}