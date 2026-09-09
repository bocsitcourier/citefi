import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import {
  users,
  sessions,
  activityLogs,
  totpSecrets,
  emailVerificationCodes,
  loginHistory,
  passwordResets,
  userQuotas,
  userInvites,
  jobBatches,
  socialPosts,
  teams,
} from "@/shared/schema";
import { and, eq, count, gt, isNull, sql } from "drizzle-orm";
import { requireAuth, AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { countActivePlatformAdmins, lockPlatformAdminState } from "@/lib/admin-invariant";
import { deliverEmail } from "@/lib/email";
import { verifyPassword } from "@/lib/auth";
import { clearCsrfCookie } from "@/lib/csrf";
import { getClientIp, rateLimitDb } from "@/lib/db-rate-limit";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    const { userId } = auth;
    const limit = await rateLimitDb(
      `account-delete:${userId}:${getClientIp(req)}`,
      5,
      60 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many account deletion attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
    const { currentPassword } = await req.json().catch(() => ({}));
    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      return NextResponse.json(
        { error: "Your current password is required" },
        { status: 400 },
      );
    }

    const [targetUser] = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        accountStatus: users.accountStatus,
        passwordHash: users.passwordHash,
        twoFactorEnabled: users.twoFactorEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (targetUser.twoFactorEnabled === 1 && auth.authAssurance !== "mfa") {
      return NextResponse.json(
        { error: "Sign in with two-factor authentication before deleting this account" },
        { status: 403 },
      );
    }
    // Block deletion if user owns content (same rule as admin delete)
    const [ownedBatches] = await db.select({ count: count() }).from(jobBatches).where(eq(jobBatches.userId, userId));
    const [ownedPosts] = await db.select({ count: count() }).from(socialPosts).where(eq(socialPosts.userId, userId));
    const [createdTeams] = await db.select({ count: count() }).from(teams).where(eq(teams.createdBy, userId));

    if ((ownedBatches?.count || 0) > 0 || (ownedPosts?.count || 0) > 0 || (createdTeams?.count || 0) > 0) {
      return NextResponse.json(
        { error: "Your account owns content (batches, posts, or teams). Please delete or reassign this content before closing your account." },
        { status: 400 }
      );
    }

    // Wrap all sequential deletes in a transaction so a mid-sequence failure
    // cannot leave the user record orphaned with auth data partially deleted.
    let deletedEmail = targetUser.email;
    await db.transaction(async (tx) => {
        await lockPlatformAdminState(tx);
        const [currentUser] = await tx.update(users)
          .set({ updatedAt: sql`${users.updatedAt}` })
          .where(and(eq(users.id, userId), eq(users.accountStatus, "active")))
          .returning({
            email: users.email,
            role: users.role,
            passwordHash: users.passwordHash,
            twoFactorEnabled: users.twoFactorEnabled,
          });
        if (!currentUser) {
          const error: any = new Error("Account changed during deletion");
          error.statusCode = 409;
          throw error;
        }
        if (!currentUser.passwordHash ||
            !(await verifyPassword(currentPassword, currentUser.passwordHash))) {
          const error: any = new Error("Current password is incorrect");
          error.statusCode = 403;
          throw error;
        }
        if (currentUser.twoFactorEnabled === 1 && auth.authAssurance !== "mfa") {
          const error: any = new Error(
            "Sign in with two-factor authentication before deleting this account",
          );
          error.statusCode = 403;
          throw error;
        }
        if (currentUser.role === "admin" &&
            await countActivePlatformAdmins(tx) <= 1) {
          const error: any = new Error(
            "The last active platform administrator cannot delete their account",
          );
          error.statusCode = 409;
          throw error;
        }
        const [liveSession] = await tx.update(sessions)
          .set({ lastActivityAt: sql`${sessions.lastActivityAt}` })
          .where(and(
            eq(sessions.id, auth.sessionId),
            eq(sessions.userId, userId),
            eq(sessions.isActive, 1),
            isNull(sessions.forceLogoutAt),
            gt(sessions.expiresAt, new Date()),
          ))
          .returning({ id: sessions.id });
        if (!liveSession) {
          const error: any = new Error("Session changed during deletion");
          error.statusCode = 409;
          throw error;
        }
        deletedEmail = currentUser.email;
        await tx.delete(sessions).where(eq(sessions.userId, userId));
        await tx.delete(activityLogs).where(eq(activityLogs.userId, userId));
        await tx.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
        await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, userId));
        await tx.delete(loginHistory).where(eq(loginHistory.userId, userId));
        await tx.delete(passwordResets).where(eq(passwordResets.userId, userId));
        await tx.delete(userQuotas).where(eq(userQuotas.userId, userId));
        // Null out nullable FK references where this user is referenced
        await tx.update(userInvites).set({ acceptedBy: null }).where(eq(userInvites.acceptedBy, userId));
        await tx.update(sessions).set({ terminatedBy: null }).where(eq(sessions.terminatedBy, userId));
        await tx.update(passwordResets).set({ initiatedBy: null }).where(eq(passwordResets.initiatedBy, userId));
        // team_members has ON DELETE CASCADE — deleted automatically when user row is removed
        await tx.delete(users).where(eq(users.id, userId));
    });

    // Send confirmation email (fire-and-forget, outside transaction)
    deliverEmail({
      to: deletedEmail,
      subject: "Your Citefi account has been deleted",
      text: "Your Citefi sign-in account and personal authentication data have been deleted. Shared team content and records subject to legal, fraud-prevention, or financial retention requirements are not represented as deleted by this action. If you did not initiate this, please contact support immediately.",
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><h2>Account Deleted</h2><p>Your Citefi sign-in account and personal authentication data have been deleted.</p><p>Shared team content and records subject to legal, fraud-prevention, or financial retention requirements are not represented as deleted by this action.</p><p style="color:#666">If you did not initiate this, please contact support immediately.</p></div>`,
    }).catch(() => {});

    const response = NextResponse.json({
      success: true,
      message: "Sign-in account and personal authentication data deleted",
    });
    response.cookies.set(AUTH_COOKIE_NAME, "", { maxAge: 0, path: "/" });
    clearCsrfCookie(response);
    return response;
  } catch (err: any) {
    const authStatus = err?.statusCode ?? err?.status;
    if (authStatus === 401 || authStatus === 403 || authStatus === 409) {
      return NextResponse.json({ error: err.message }, { status: authStatus });
    }
    console.error("[account/delete] request failed", {
      error: err instanceof Error ? err.message : "Unknown account deletion error",
    });
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
