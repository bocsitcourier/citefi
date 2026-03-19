import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, totpSecrets, activityLogs } from "@/shared/schema";
import { verifyToken, generateTOTPSecret, verifyTOTPToken, generateBackupCodes, hashBackupCodes } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Unauthorized - No token provided" },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid token" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action, verificationCode } = body;

    if (action === "generate") {
      // Generate new TOTP secret
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);

      if (!user) {
        return NextResponse.json(
          { error: "User not found" },
          { status: 404 }
        );
      }

      const totpSetup = await generateTOTPSecret(user.email);

      // Return QR code and manual entry key (don't save to DB yet)
      return NextResponse.json({
        qrCodeUrl: totpSetup.qrCodeUrl,
        manualEntryKey: totpSetup.manualEntryKey,
        secret: totpSetup.secret, // Temporary, will be confirmed in next step
      });

    } else if (action === "verify") {
      // Verify and save TOTP secret
      const { secret } = body;

      if (!secret || !verificationCode) {
        return NextResponse.json(
          { error: "Secret and verification code are required" },
          { status: 400 }
        );
      }

      // Verify the code
      const verified = verifyTOTPToken(verificationCode, secret);

      if (!verified) {
        return NextResponse.json(
          { error: "Invalid verification code" },
          { status: 401 }
        );
      }

      // Generate backup codes
      const backupCodes = await generateBackupCodes(10);
      const hashedBackupCodes = await hashBackupCodes(backupCodes);

      // Check if TOTP already exists
      const [existingTotp] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, payload.userId))
        .limit(1);

      if (existingTotp) {
        // Update existing
        await db
          .update(totpSecrets)
          .set({
            secret,
            backupCodes: hashedBackupCodes,
          })
          .where(eq(totpSecrets.userId, payload.userId));
      } else {
        // Create new
        await db
          .insert(totpSecrets)
          .values({
            userId: payload.userId,
            secret,
            backupCodes: hashedBackupCodes,
          });
      }

      // Enable 2FA for user
      await db
        .update(users)
        .set({
          twoFactorEnabled: 1,
          twoFactorMethod: "totp",
        })
        .where(eq(users.id, payload.userId));

      // Log activity
      await db.insert(activityLogs).values({
        userId: payload.userId,
        action: "totp_setup",
        resource: "users",
        resourceId: payload.userId,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        severity: "info",
      });

      return NextResponse.json({
        message: "TOTP setup successful",
        backupCodes, // Return plain backup codes once for user to save
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
