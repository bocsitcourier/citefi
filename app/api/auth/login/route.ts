import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, activityLogs } from "@/shared/schema";
import { verifyPassword, generateAccessToken, hashToken, isAccountLocked, calculateLockoutDuration } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!user) {
      // Log failed login attempt (no user found)
      await db.insert(activityLogs).values({
        action: "login_failed",
        resource: "users",
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email, reason: "user_not_found" },
        severity: "warning",
      });

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check if account is locked
    if (isAccountLocked(user.lockedUntil)) {
      const lockoutRemaining = Math.ceil((new Date(user.lockedUntil!).getTime() - Date.now()) / 1000 / 60);
      
      await db.insert(activityLogs).values({
        userId: user.id,
        action: "login_blocked",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email, reason: "account_locked", lockoutRemaining },
        severity: "warning",
      });

      return NextResponse.json(
        { error: `Account is locked. Try again in ${lockoutRemaining} minutes.` },
        { status: 403 }
      );
    }

    // Check account status
    if (user.accountStatus !== "active") {
      await db.insert(activityLogs).values({
        userId: user.id,
        action: "login_blocked",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email, reason: "account_not_active", status: user.accountStatus },
        severity: "warning",
      });

      // Provide specific messages for different account statuses
      if (user.accountStatus === "pending_approval") {
        return NextResponse.json(
          { error: "Your account is pending admin approval. Please wait for an administrator to review your registration." },
          { status: 403 }
        );
      }

      if (user.accountStatus === "suspended") {
        return NextResponse.json(
          { error: "Your account has been suspended. Please contact an administrator for assistance." },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: `Account is ${user.accountStatus}. Please contact support.` },
        { status: 403 }
      );
    }

    // Verify password
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      // Increment failed login attempts
      const newFailedAttempts = (user.failedLoginAttempts || 0) + 1;
      const lockoutDuration = calculateLockoutDuration(newFailedAttempts);
      const lockedUntil = lockoutDuration > 0 ? new Date(Date.now() + lockoutDuration) : null;

      await db
        .update(users)
        .set({
          failedLoginAttempts: newFailedAttempts,
          lockedUntil,
        })
        .where(eq(users.id, user.id));

      await db.insert(activityLogs).values({
        userId: user.id,
        action: "login_failed",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email, reason: "invalid_password", failedAttempts: newFailedAttempts },
        severity: "warning",
      });

      if (lockedUntil) {
        const lockoutMinutes = Math.ceil(lockoutDuration / 1000 / 60);
        return NextResponse.json(
          { error: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.` },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Return partial token that requires 2FA verification
      return NextResponse.json({
        requiresTwoFactor: true,
        userId: user.id,
        twoFactorMethod: user.twoFactorMethod,
        message: "Please complete 2FA verification",
      });
    }

    // No 2FA required - generate full access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const tokenHash = hashToken(accessToken);

    // Create session
    const [session] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      })
      .returning();

    // Reset failed login attempts and update last login
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Log successful login
    await db.insert(activityLogs).values({
      userId: user.id,
      action: "login_success",
      resource: "users",
      resourceId: user.id,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { email },
      severity: "info",
    });

    return NextResponse.json({
      message: "Login successful",
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled === 1,
      },
    });

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
