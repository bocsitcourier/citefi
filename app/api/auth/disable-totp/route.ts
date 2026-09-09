import { NextRequest, NextResponse } from "next/server";
import { systemDb } from "@/lib/db";
import { users, sessions, totpSecrets, activityLogs } from "@/shared/schema";
import { verifyToken } from "@/lib/api/auth";
import { verifyPassword, verifyTOTPTokenCounter } from "@/lib/auth";
import { decryptTOTPSecret } from "@/lib/totp-security";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`totp-disable:${ip}`, 3, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized - Invalid or expired session" }, { status: 401 });
    }

    const userRl = await rateLimitDb(`totp-disable:user:${authResult.userId}`, 3, 15 * 60 * 1000);
    if (!userRl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(userRl.retryAfter) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const outcome = await systemDb.transaction(async (tx) => {
      const [user] = await tx.update(users)
        .set({ updatedAt: sql`${users.updatedAt}` })
        .where(and(eq(users.id, authResult.userId), eq(users.accountStatus, "active")))
        .returning({
          passwordHash: users.passwordHash,
          role: users.role,
          twoFactorEnabled: users.twoFactorEnabled,
          twoFactorMethod: users.twoFactorMethod,
          mfaEnrollmentDeadline: users.mfaEnrollmentDeadline,
        });
      if (!user?.passwordHash || user.twoFactorEnabled !== 1 || user.twoFactorMethod !== "totp") {
        return "invalid" as const;
      }
      if (
        user.role === "admin" &&
        (
          !user.mfaEnrollmentDeadline ||
          user.mfaEnrollmentDeadline.getTime() <= now.getTime()
        )
      ) {
        return "admin_policy" as const;
      }
      if (!body.currentPassword || !(await verifyPassword(String(body.currentPassword), user.passwordHash))) {
        return "invalid" as const;
      }

      const [totp] = await tx.select().from(totpSecrets)
        .where(eq(totpSecrets.userId, authResult.userId))
        .limit(1);
      if (!totp) return "invalid" as const;
      const secret = decryptTOTPSecret(totp.secretCiphertext, totp.secretKeyVersion, totp.secret);
      const counter = verifyTOTPTokenCounter(String(body.verificationCode || ""), secret);
      if (counter === null || (totp.lastUsedCounter !== null && counter <= totp.lastUsedCounter)) {
        return "invalid" as const;
      }
      const [consumed] = await tx.update(totpSecrets)
        .set({ lastUsedAt: now, lastUsedCounter: counter })
        .where(and(
          eq(totpSecrets.userId, authResult.userId),
          eq(totpSecrets.credentialVersion, totp.credentialVersion),
          or(isNull(totpSecrets.lastUsedCounter), lt(totpSecrets.lastUsedCounter, counter)),
        ))
        .returning({ id: totpSecrets.id });
      if (!consumed) return "invalid" as const;

      await tx.delete(totpSecrets).where(and(
        eq(totpSecrets.userId, authResult.userId),
        eq(totpSecrets.credentialVersion, totp.credentialVersion),
      ));
      await tx.update(users)
        .set({ twoFactorEnabled: 0, twoFactorMethod: null })
        .where(eq(users.id, authResult.userId));
      await tx.update(sessions).set({
        isActive: 0,
        forceLogoutAt: now,
        terminationReason: "Two-factor authentication disabled",
      }).where(and(
        eq(sessions.userId, authResult.userId),
        ne(sessions.id, authResult.sessionId),
      ));
      await tx.update(sessions).set({
        authAssurance: "password",
        mfaVerifiedAt: null,
      }).where(and(
        eq(sessions.id, authResult.sessionId),
        eq(sessions.userId, authResult.userId),
      ));
      await tx.insert(activityLogs).values({
        userId: authResult.userId,
        action: "totp_disabled",
        resource: "users",
        resourceId: authResult.userId,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { otherSessionsRevoked: true, stepUpVerified: true },
        severity: "warning",
      });
      return "ok" as const;
    });
    if (outcome === "admin_policy") {
      return NextResponse.json(
        { error: "Administrator MFA is required by policy and cannot be disabled" },
        { status: 409 },
      );
    }
    if (outcome !== "ok") {
      return NextResponse.json(
        { error: "Current password and a new, valid Google Authenticator code are required" },
        { status: 401 },
      );
    }

    return NextResponse.json({ message: "Two-factor authentication disabled" });
  } catch (error) {
    console.error("Disable TOTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
