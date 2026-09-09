import { NextRequest, NextResponse } from "next/server";
import { systemDb } from "@/lib/db";
import {
  users,
  sessions,
  activityLogs,
  loginChallenges,
  emailVerificationCodes,
  passwordResets,
} from "@/shared/schema";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/auth";
import { verifyToken } from "@/lib/api/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, isNull, ne, gt, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`change-password:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many password change attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);
    if (!authResult) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.errors.join(". ") },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from your current password" },
        { status: 400 }
      );
    }

    const [user] = await systemDb
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, authResult.userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const verifiedPasswordHash = user.passwordHash;

    const isValid = await verifyPassword(currentPassword, verifiedPasswordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);

    // Atomic: update password AND revoke other sessions in a single transaction.
    // If either step fails, neither is committed — no partial security state.
    let revokedCount = 0;
    await systemDb.transaction(async (tx) => {
      // Lock and revalidate the authenticated session before changing identity
      // state. A concurrent reset/revocation cannot leave this transaction
      // relying on stale reauthentication.
      const [liveSession] = await tx
        .update(sessions)
        .set({ lastActivityAt: sql`${sessions.lastActivityAt}` })
        .where(and(
          eq(sessions.id, authResult.sessionId),
          eq(sessions.userId, user.id),
          eq(sessions.isActive, 1),
          isNull(sessions.forceLogoutAt),
          gt(sessions.expiresAt, new Date()),
        ))
        .returning({ id: sessions.id });
      if (!liveSession) {
        const error: any = new Error("Session changed during password update");
        error.statusCode = 409;
        throw error;
      }

      const [updatedUser] = await tx
        .update(users)
        .set({ passwordHash: hashedPassword })
        .where(and(
          eq(users.id, user.id),
          eq(users.passwordHash, verifiedPasswordHash),
        ))
        .returning({ id: users.id });
      if (!updatedUser) {
        const error: any = new Error("Password changed during this request");
        error.statusCode = 409;
        throw error;
      }

      // Revoke all OTHER active sessions — stolen tokens become invalid immediately.
      // Current session (authResult.sessionId) stays alive so the user isn't logged out.
      const revoked = await tx
        .update(sessions)
        .set({
          isActive: 0,
          forceLogoutAt: new Date(),
          terminationReason: "Password changed",
        })
        .where(
          and(
            eq(sessions.userId, user.id),
            ne(sessions.id, authResult.sessionId),
            isNull(sessions.forceLogoutAt)
          )
        )
        .returning({ id: sessions.id });
      revokedCount = revoked.length;
      await tx.update(loginChallenges)
        .set({ consumedAt: new Date() })
        .where(and(
          eq(loginChallenges.userId, user.id),
          isNull(loginChallenges.consumedAt),
        ));
      await tx.update(emailVerificationCodes)
        .set({ isUsed: 1 })
        .where(and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.purpose, "password_reset"),
          eq(emailVerificationCodes.isUsed, 0),
        ));
      await tx.update(passwordResets)
        .set({ status: "cancelled" })
        .where(and(
          eq(passwordResets.userId, user.id),
          eq(passwordResets.status, "pending"),
        ));
    });

    await systemDb.insert(activityLogs).values({
      userId: user.id,
      action: "password_changed",
      resource: "users",
      resourceId: user.id,
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      userAgent: req.headers.get("user-agent") || null,
      details: { otherSessionsRevoked: revokedCount },
      severity: "info",
    });

    return NextResponse.json({ message: "Password changed successfully" });
  } catch (error) {
    const status = (error as any)?.statusCode;
    if (status === 409) {
      return NextResponse.json(
        { error: "Your password or session changed. Please sign in and try again." },
        { status: 409 },
      );
    }
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
