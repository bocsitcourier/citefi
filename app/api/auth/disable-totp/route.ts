import { NextRequest, NextResponse } from "next/server";
import { getTxDb, systemDb } from "@/lib/db";
import { users, sessions, totpSecrets, activityLogs } from "@/shared/schema";
import { verifyToken } from "@/lib/api/auth";
import { verifyPassword, verifyTOTPToken } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { and, eq, ne } from "drizzle-orm";

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
    const [user] = await systemDb.select({
      passwordHash: users.passwordHash,
      twoFactorEnabled: users.twoFactorEnabled,
      twoFactorMethod: users.twoFactorMethod,
    }).from(users).where(eq(users.id, authResult.userId)).limit(1);
    const [totp] = await systemDb.select({
      secret: totpSecrets.secret,
    }).from(totpSecrets).where(eq(totpSecrets.userId, authResult.userId)).limit(1);

    const passwordOk = !!user?.passwordHash && !!body.currentPassword &&
      await verifyPassword(String(body.currentPassword), user.passwordHash);
    const totpOk = !!totp?.secret && verifyTOTPToken(String(body.verificationCode || ""), totp.secret);
    if (!user || user.twoFactorEnabled !== 1 || user.twoFactorMethod !== "totp" || !passwordOk || !totpOk) {
      return NextResponse.json(
        { error: "Current password and a valid Google Authenticator code are required" },
        { status: 401 }
      );
    }

    const now = new Date();
    await getTxDb().transaction(async (tx) => {
      await tx.delete(totpSecrets).where(eq(totpSecrets.userId, authResult.userId));
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
    });

    return NextResponse.json({ message: "Two-factor authentication disabled" });
  } catch (error) {
    console.error("Disable TOTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
