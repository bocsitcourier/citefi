import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, totpSecrets, activityLogs } from "@/shared/schema";
import { generateTOTPSecret, verifyTOTPToken, generateBackupCodes, hashBackupCodes } from "@/lib/auth";
import { verifyToken } from "@/lib/api/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`totp-setup:${ip}`, 5, 15 * 60 * 1000);
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
      const [user] = await db
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

      const totpSetup = await generateTOTPSecret(user.email);

      return NextResponse.json({
        qrCodeUrl: totpSetup.qrCodeUrl,
        manualEntryKey: totpSetup.manualEntryKey,
        secret: totpSetup.secret,
      });

    } else if (action === "verify") {
      const { secret } = body;

      if (!secret || !verificationCode) {
        return NextResponse.json(
          { error: "Secret and verification code are required" },
          { status: 400 }
        );
      }

      const verified = verifyTOTPToken(verificationCode, secret);

      if (!verified) {
        return NextResponse.json(
          { error: "Invalid verification code" },
          { status: 401 }
        );
      }

      const backupCodes = await generateBackupCodes(10);
      const hashedBackupCodes = await hashBackupCodes(backupCodes);

      const [existingTotp] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, authResult.userId))
        .limit(1);

      if (existingTotp) {
        await db
          .update(totpSecrets)
          .set({
            secret,
            backupCodes: hashedBackupCodes,
          })
          .where(eq(totpSecrets.userId, authResult.userId));
      } else {
        await db
          .insert(totpSecrets)
          .values({
            userId: authResult.userId,
            secret,
            backupCodes: hashedBackupCodes,
          });
      }

      await db
        .update(users)
        .set({
          twoFactorEnabled: 1,
          twoFactorMethod: "totp",
        })
        .where(eq(users.id, authResult.userId));

      await db.insert(activityLogs).values({
        userId: authResult.userId,
        action: "totp_setup",
        resource: "users",
        resourceId: authResult.userId,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        severity: "info",
      });

      return NextResponse.json({
        message: "TOTP setup successful",
        backupCodes,
      });
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
