import { NextRequest, NextResponse } from "next/server";
import { getTxDb, systemDb } from "@/lib/db";
import { users, sessions, totpSecrets, activityLogs } from "@/shared/schema";
import {
  generateTOTPSecret,
  verifyTOTPToken,
  generateBackupCodes,
  hashBackupCodes,
  verifyPassword,
  generateTOTPSetupToken,
  verifyTOTPSetupToken,
} from "@/lib/auth";
import { verifyToken } from "@/lib/api/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { and, eq, ne } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`totp-setup:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many TOTP setup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);

    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid or expired session" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action, verificationCode } = body;

    if (action === "generate") {
      const [user] = await systemDb
        .select()
        .from(users)
        .where(eq(users.id, authResult.userId))
        .limit(1);

      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }
      if (!body.currentPassword || !user.passwordHash ||
          !(await verifyPassword(String(body.currentPassword), user.passwordHash))) {
        return NextResponse.json(
          { error: "Current password is required to enable two-factor authentication" },
          { status: 401 }
        );
      }

      const totpSetup = await generateTOTPSecret(user.email);
      const setupToken = generateTOTPSetupToken(user.id, totpSetup.secret);

      return NextResponse.json({
        qrCodeUrl: totpSetup.qrCodeUrl,
        manualEntryKey: totpSetup.manualEntryKey,
        setupToken,
      }, { headers: { "Cache-Control": "no-store" } });

    } else if (action === "verify") {
      const setup = verifyTOTPSetupToken(String(body.setupToken || ""));

      if (!setup || setup.userId !== authResult.userId || !verificationCode) {
        return NextResponse.json(
          { error: "The authenticator setup has expired. Start again." },
          { status: 400 }
        );
      }

      const verified = verifyTOTPToken(String(verificationCode), setup.secret);

      if (!verified) {
        return NextResponse.json(
          { error: "Invalid verification code" },
          { status: 401 }
        );
      }

      const backupCodes = await generateBackupCodes(10);
      const hashedBackupCodes = await hashBackupCodes(backupCodes);

      const now = new Date();
      await getTxDb().transaction(async (tx) => {
        await tx.insert(totpSecrets).values({
          userId: authResult.userId,
          secret: setup.secret,
          backupCodes: hashedBackupCodes,
        }).onConflictDoUpdate({
          target: totpSecrets.userId,
          set: { secret: setup.secret, backupCodes: hashedBackupCodes, lastUsedAt: null },
        });
        await tx.update(users).set({
          twoFactorEnabled: 1,
          twoFactorMethod: "totp",
        }).where(eq(users.id, authResult.userId));
        await tx.update(sessions).set({
          isActive: 0,
          forceLogoutAt: now,
          terminationReason: "Two-factor authentication enabled",
        }).where(and(
          eq(sessions.userId, authResult.userId),
          ne(sessions.id, authResult.sessionId),
        ));
        await tx.insert(activityLogs).values({
          userId: authResult.userId,
          action: "totp_setup",
          resource: "users",
          resourceId: authResult.userId,
          ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
          userAgent: req.headers.get("user-agent") || null,
          details: { otherSessionsRevoked: true },
          severity: "info",
        });
      });

      return NextResponse.json({
        message: "TOTP setup successful",
        backupCodes,
      }, { headers: { "Cache-Control": "no-store" } });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'generate' or 'verify'" },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error("TOTP setup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
