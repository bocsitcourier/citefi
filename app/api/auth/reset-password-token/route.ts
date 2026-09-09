import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import {
  users,
  passwordResets,
  emailVerificationCodes,
  sessions,
  loginChallenges,
  activityLogs,
} from "@/shared/schema";
import { hashToken, hashPassword } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, ne, gt, isNull, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`reset-token-validate:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token || token.length < 32) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    const [reset] = await db
      .select({
        id: passwordResets.id,
        userId: passwordResets.userId,
        status: passwordResets.status,
        expiresAt: passwordResets.expiresAt,
      })
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          eq(passwordResets.status, "pending")
        )
      )
      .limit(1);

    if (!reset || reset.expiresAt <= now) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, reset.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    return NextResponse.json({ valid: true, email: user.email });
  } catch (error) {
    console.error("[reset-password-token GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`reset-token-apply:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    const passwordHash = await hashPassword(newPassword);
    const resetApplied = await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ id: passwordResets.id, userId: passwordResets.userId })
        .from(passwordResets)
        .where(and(
          eq(passwordResets.tokenHash, tokenHash),
          eq(passwordResets.status, "pending"),
          gt(passwordResets.expiresAt, now),
        ))
        .limit(1);
      if (!candidate) return false;

      const [lockedUser] = await tx
        .update(users)
        .set({ passwordHash: sql`${users.passwordHash}` })
        .where(eq(users.id, candidate.userId))
        .returning({ id: users.id });
      if (!lockedUser) return false;

      const [consumed] = await tx
        .update(passwordResets)
        .set({ status: "used", usedAt: now })
        .where(and(
          eq(passwordResets.id, candidate.id),
          eq(passwordResets.tokenHash, tokenHash),
          eq(passwordResets.status, "pending"),
          gt(passwordResets.expiresAt, now),
        ))
        .returning({ userId: passwordResets.userId, id: passwordResets.id });
      if (!consumed) return false;

      const [updatedUser] = await tx.update(users)
        .set({
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, consumed.userId))
        .returning({ id: users.id });
      if (!updatedUser) throw new Error("Password reset user no longer exists");

      await tx.update(passwordResets)
        .set({ status: "cancelled" })
        .where(and(
          eq(passwordResets.userId, consumed.userId),
          eq(passwordResets.status, "pending"),
          ne(passwordResets.id, consumed.id),
        ));
      await tx.update(emailVerificationCodes)
        .set({ isUsed: 1 })
        .where(and(
          eq(emailVerificationCodes.userId, consumed.userId),
          eq(emailVerificationCodes.purpose, "password_reset"),
          eq(emailVerificationCodes.isUsed, 0),
        ));
      await tx.update(sessions)
        .set({
          isActive: 0,
          forceLogoutAt: now,
          terminationReason: "Password reset completed",
        })
        .where(and(
          eq(sessions.userId, consumed.userId),
          eq(sessions.isActive, 1),
        ));
      await tx.update(loginChallenges)
        .set({ consumedAt: now })
        .where(and(
          eq(loginChallenges.userId, consumed.userId),
          isNull(loginChallenges.consumedAt),
        ));
      await tx.insert(activityLogs).values({
        userId: consumed.userId,
        action: "password_reset_completed",
        resource: "users",
        resourceId: consumed.userId,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { resetType: "token_link", allSessionsRevoked: true },
        severity: "warning",
      });
      return true;
    });
    if (!resetApplied) {
      return NextResponse.json(
        { error: "Invalid or expired link. Please request a new one." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { success: true, message: "Password updated successfully. Sign in again on every device." },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[reset-password-token POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
