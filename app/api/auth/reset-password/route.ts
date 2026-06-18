import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, emailVerificationCodes, activityLogs } from "@/shared/schema";
import { hashPassword } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, gt } from "drizzle-orm";

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

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const emailRl = await rateLimitDb(`reset-password:email:${email.toLowerCase().trim()}`, 5, 15 * 60 * 1000);
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailRl.retryAfter) } }
      );
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired reset code" }, { status: 400 });
    }

    const [verificationCode] = await db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.userId, user.id),
          eq(emailVerificationCodes.purpose, "password_reset"),
          eq(emailVerificationCodes.code, code),
          eq(emailVerificationCodes.isUsed, 0),
          gt(emailVerificationCodes.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!verificationCode) {
      // Increment attempts if code exists but is wrong
      await db
        .update(emailVerificationCodes)
        .set({ attempts: (verificationCode as any)?.attempts + 1 || 1 })
        .where(
          and(
            eq(emailVerificationCodes.userId, user.id),
            eq(emailVerificationCodes.purpose, "password_reset"),
            eq(emailVerificationCodes.isUsed, 0)
          )
        );
      return NextResponse.json({ error: "Invalid or expired reset code" }, { status: 400 });
    }

    const hashedPassword = await hashPassword(newPassword);

    await db.update(users).set({ passwordHash: hashedPassword }).where(eq(users.id, user.id));

    await db
      .update(emailVerificationCodes)
      .set({ isUsed: 1 })
      .where(eq(emailVerificationCodes.id, verificationCode.id));

    await db.insert(activityLogs).values({
      userId: user.id,
      action: "password_reset_completed",
      resource: "users",
      resourceId: user.id,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { email: user.email },
      severity: "info",
    });

    return NextResponse.json({ message: "Password reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
