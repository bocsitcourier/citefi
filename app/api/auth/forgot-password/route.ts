import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, emailVerificationCodes, activityLogs } from "@/shared/schema";
import { generateEmailCode } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user || user.accountStatus === "suspended") {
      // Return success even if user not found (security: don't reveal email existence)
      return NextResponse.json({ message: "If this email is registered, you will receive a reset code." });
    }

    const code = generateEmailCode();

    // Expire existing reset codes for this user
    await db
      .update(emailVerificationCodes)
      .set({ isUsed: 1 })
      .where(
        and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.purpose, "password_reset")
        )
      );

    // Create new code (expires in 15 minutes)
    await db.insert(emailVerificationCodes).values({
      userId: user.id,
      code,
      purpose: "password_reset",
      attempts: 0,
      isUsed: 0,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await db.insert(activityLogs).values({
      userId: user.id,
      action: "password_reset_requested",
      resource: "users",
      resourceId: user.id,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { email: user.email },
      severity: "info",
    });

    console.log(`🔐 Password reset code for ${user.email}: ${code}`);

    return NextResponse.json({
      message: "If this email is registered, you will receive a reset code.",
      ...(process.env.NODE_ENV === "development" && { code, userId: user.id }),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
