import { NextResponse } from "next/server";
import { db, getTxDb } from "@/lib/db";
import { users, activityLogs } from "@/shared/schema";
import { hashPassword, validatePassword } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    // Rate limit by IP: 5 signups per hour
    const ip = getClientIp(req);
    const limit = rateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json();
    const { email, password, fullName, role } = body;

    // Validate required fields
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { 
          error: passwordValidation.errors.join(". "), 
          details: passwordValidation.errors 
        },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate email verification token
    const crypto = require('crypto');
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const userCount = await db.select({ id: users.id }).from(users).limit(1);
    const isFirstUser = userCount.length === 0;
    
    // First user becomes admin with active status, others are always team_member and need approval
    // SECURITY: Always assign team_member role - ignore client role parameter to prevent privilege escalation
    const userRole = isFirstUser ? "admin" : "team_member";
    const accountStatus = isFirstUser ? "active" : "pending_approval";
    
    // Atomically create the user and its signup activity log. If the activity
    // log insert fails, the user insert is rolled back too (no orphan accounts).
    const txDb = getTxDb();
    const newUser = await txDb.transaction(async (tx) => {
      const [createdUser] = await tx
        .insert(users)
        .values({
          email: email.toLowerCase(),
          passwordHash,
          fullName: fullName || null,
          role: userRole,
          accountStatus: accountStatus,
          emailVerified: isFirstUser ? 1 : 0, // First user auto-verified
          twoFactorEnabled: 0,
        })
        .returning();

      await tx.insert(activityLogs).values({
        userId: createdUser!.id,
        action: "user_signup",
        resource: "users",
        resourceId: createdUser!.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email: createdUser!.email, role: createdUser!.role, status: accountStatus },
        severity: "info",
      });

      return createdUser!;
    });

    // TODO: Send email verification email to user
    // TODO: Notify admin of new user signup for approval

    return NextResponse.json({
      message: "Account created successfully! Please check your email to verify your account. An admin will review your registration shortly.",
      user: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.fullName,
        role: newUser.role,
        accountStatus: "pending_approval",
        emailVerified: false,
      },
    }, { status: 201 });

  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
