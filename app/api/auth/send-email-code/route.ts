import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, emailVerificationCodes, activityLogs } from "@/shared/schema";
import { generateEmailCode } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`email-code:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many code requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { userId, purpose } = body;

    if (!userId || !purpose) {
      return NextResponse.json(
        { error: "userId and purpose are required" },
        { status: 400 }
      );
    }

    const userRl = await rateLimitDb(`email-code:user:${userId}`, 5, 15 * 60 * 1000);
    if (!userRl.allowed) {
      return NextResponse.json(
        { error: "Too many code requests for this account. Please try again later." },
        { status: 429, headers: { "Retry-After": String(userRl.retryAfter) } }
      );
    }

    // Validate purpose
    const validPurposes = ["login_2fa", "email_verification", "password_reset"];
    if (!validPurposes.includes(purpose)) {
      return NextResponse.json(
        { error: "Invalid purpose" },
        { status: 400 }
      );
    }

    // Fetch user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Generate 6-digit code
    const code = generateEmailCode();

    // Expire any existing codes for this user and purpose
    await db
      .update(emailVerificationCodes)
      .set({ isUsed: 1 })
      .where(
        and(
          eq(emailVerificationCodes.userId, userId),
          eq(emailVerificationCodes.purpose, purpose)
        )
      );

    // Create new code (expires in 10 minutes)
    await db
      .insert(emailVerificationCodes)
      .values({
        userId,
        code,
        purpose,
        attempts: 0,
        isUsed: 0,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      });

    // Log activity
    await db.insert(activityLogs).values({
      userId,
      action: "email_code_sent",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { purpose },
      severity: "info",
    });

    // TODO: In production, send email via email service (e.g., SendGrid, AWS SES)
    console.log(`📧 Email verification code for ${user.email}: ${code}`);

    return NextResponse.json({
      message: "Verification code sent successfully",
      expiresIn: 600, // 10 minutes in seconds
      // In development, return code for testing
      ...(process.env.NODE_ENV === "development" && { code }),
    });

  } catch (error) {
    console.error("Send email code error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
