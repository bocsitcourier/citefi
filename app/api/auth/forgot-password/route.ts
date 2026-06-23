import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, emailVerificationCodes, activityLogs } from "@/shared/schema";
import { generateEmailCode } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { deliverEmail } from "@/lib/email";
import { eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`forgot-password:${ip}`, 3, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const emailRl = await rateLimitDb(`forgot-password:email:${email.toLowerCase().trim()}`, 3, 60 * 60 * 1000);
    if (!emailRl.allowed) {
      return NextResponse.json(
        { error: "Too many password reset attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(emailRl.retryAfter) } }
      );
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

    if (process.env.NODE_ENV === "development") {
      console.log(`🔐 Password reset code for ${user.email}: ${code}`);
    }

    await deliverEmail({
      to: user.email,
      subject: "Your Citefi password reset code",
      text: `Your password reset code is: ${code}\n\nThis code expires in 15 minutes.\n\nIf you didn't request a password reset, you can safely ignore this email.`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
<h2 style="margin-bottom:8px">Password Reset</h2>
<p style="color:#666">Enter this code on the password reset page:</p>
<div style="font-size:2em;font-weight:bold;letter-spacing:0.4em;padding:16px;background:#f5f5f5;border-radius:6px;text-align:center;margin:16px 0">${code}</div>
<p style="color:#666;font-size:0.9em">This code expires in <strong>15 minutes</strong>.</p>
<p style="color:#999;font-size:0.8em">If you didn't request a password reset, you can safely ignore this email.</p>
</div>`,
    });

    return NextResponse.json({
      message: "If this email is registered, you will receive a reset code.",
      ...(process.env.NODE_ENV === "development" && { code, userId: user.id }),
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
