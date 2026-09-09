import { NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import {
  users,
  sessions,
  emailVerificationCodes,
  loginChallenges,
  passwordResets,
  activityLogs,
} from "@/shared/schema";
import { hashPassword, validatePassword } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, gt, isNull, lt, sql } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`reset-password:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { email, code, newPassword } = body;

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Email, code, and new password are required" }, { status: 400 });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: "Password does not meet security requirements", details: passwordValidation.errors },
        { status: 400 },
      );
    }

    const emailRl = await rateLimitDb(`reset-password:email:${email.toLowerCase().trim()}`, 5, 15 * 60 * 1000);
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailRl.retryAfter) } }
      );
    }

    const hashedPassword = await hashPassword(newPassword);
    const now = new Date();
    const resetApplied = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);
      if (!user) return false;

      const [lockedUser] = await tx
        .update(users)
        .set({ passwordHash: sql`${users.passwordHash}` })
        .where(eq(users.id, user.id))
        .returning({ id: users.id });
      if (!lockedUser) return false;

      const [claimedCode] = await tx
        .update(emailVerificationCodes)
        .set({ isUsed: 1 })
        .where(and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.purpose, "password_reset"),
          eq(emailVerificationCodes.code, String(code)),
          eq(emailVerificationCodes.isUsed, 0),
          lt(emailVerificationCodes.attempts, 5),
          gt(emailVerificationCodes.expiresAt, now),
        ))
        .returning({ id: emailVerificationCodes.id });

      if (!claimedCode) {
        await tx
          .update(emailVerificationCodes)
          .set({
            attempts: sql`${emailVerificationCodes.attempts} + 1`,
            isUsed: sql`CASE WHEN ${emailVerificationCodes.attempts} >= 4 THEN 1 ELSE ${emailVerificationCodes.isUsed} END`,
          })
          .where(and(
            eq(emailVerificationCodes.userId, user.id),
            eq(emailVerificationCodes.purpose, "password_reset"),
            eq(emailVerificationCodes.isUsed, 0),
            gt(emailVerificationCodes.expiresAt, now),
          ));
        return false;
      }

      await tx.update(users)
        .set({ passwordHash: hashedPassword })
        .where(eq(users.id, user.id));
      await tx.update(sessions)
        .set({
          isActive: 0,
          forceLogoutAt: now,
          terminationReason: "Password reset",
        })
        .where(eq(sessions.userId, user.id));
      await tx.update(loginChallenges)
        .set({ consumedAt: now })
        .where(and(eq(loginChallenges.userId, user.id), isNull(loginChallenges.consumedAt)));
      await tx.update(passwordResets)
        .set({ status: "cancelled" })
        .where(and(eq(passwordResets.userId, user.id), eq(passwordResets.status, "pending")));
      await tx.update(emailVerificationCodes)
        .set({ isUsed: 1 })
        .where(and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.purpose, "password_reset"),
          eq(emailVerificationCodes.isUsed, 0),
        ));
      await tx.insert(activityLogs).values({
        userId: user.id,
        action: "password_reset_completed",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
        userAgent: req.headers.get("user-agent") || null,
        details: { sessionsRevoked: true, pendingChallengesConsumed: true },
        severity: "warning",
      });
      return true;
    });
    if (!resetApplied) {
      return NextResponse.json({ error: "Invalid or expired reset code" }, { status: 400 });
    }

    return NextResponse.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
