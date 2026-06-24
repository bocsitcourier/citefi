import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, activityLogs, totpSecrets, emailVerificationCodes } from "@/shared/schema";
import { generateAccessToken, hashToken, verifyTOTPToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, gt } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`2fa-verify:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { userId, code, method, challengeToken } = body;

    if (!userId || !code || !method || !challengeToken) {
      return NextResponse.json(
        { error: "userId, code, method, and challengeToken are required" },
        { status: 400 }
      );
    }

    const userRl = await rateLimitDb(`2fa-verify:user:${userId}`, 5, 15 * 60 * 1000);
    if (!userRl.allowed) {
      return NextResponse.json(
        { error: "Too many verification attempts for this account. Please try again later." },
        { status: 429, headers: { "Retry-After": String(userRl.retryAfter) } }
      );
    }

    // Atomically consume the challenge token in a single conditional UPDATE.
    // A two-step SELECT→UPDATE pattern allows two concurrent verify-2fa requests to both
    // read isUsed=0 before either marks it used, enabling replay. The single UPDATE with
    // all predicates in the WHERE clause ensures only one concurrent request can succeed.
    const [consumed] = await db
      .update(emailVerificationCodes)
      .set({ isUsed: 1 })
      .where(and(
        eq(emailVerificationCodes.userId, userId),
        eq(emailVerificationCodes.code, String(challengeToken)),
        eq(emailVerificationCodes.purpose, "2fa_challenge_token"),
        eq(emailVerificationCodes.isUsed, 0),
        gt(emailVerificationCodes.expiresAt, new Date())
      ))
      .returning({ id: emailVerificationCodes.id });

    if (!consumed) {
      return NextResponse.json(
        { error: "Invalid or expired login session. Please log in again." },
        { status: 401 }
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

    // Verify 2FA based on method
    let verified = false;

    if (method === "totp") {
      // Verify TOTP (Google Authenticator)
      const [totpSecret] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, userId))
        .limit(1);

      if (!totpSecret) {
        return NextResponse.json(
          { error: "TOTP not set up for this user" },
          { status: 400 }
        );
      }

      verified = verifyTOTPToken(code, totpSecret.secret);

      if (verified) {
        // Update last used timestamp
        await db
          .update(totpSecrets)
          .set({ lastUsedAt: new Date() })
          .where(eq(totpSecrets.userId, userId));
      }
    } else if (method === "email") {
      // Verify email code
      const [emailCode] = await db
        .select()
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.userId, userId),
            eq(emailVerificationCodes.code, code),
            eq(emailVerificationCodes.purpose, "login_2fa"),
            eq(emailVerificationCodes.isUsed, 0)
          )
        )
        .limit(1);

      if (!emailCode) {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 401 }
        );
      }

      // Check if expired
      if (new Date() > new Date(emailCode.expiresAt)) {
        return NextResponse.json(
          { error: "Verification code has expired" },
          { status: 401 }
        );
      }

      // Check attempts
      if (emailCode.attempts >= 5) {
        return NextResponse.json(
          { error: "Too many verification attempts" },
          { status: 429 }
        );
      }

      // Increment attempts
      await db
        .update(emailVerificationCodes)
        .set({ attempts: emailCode.attempts + 1 })
        .where(eq(emailVerificationCodes.id, emailCode.id));

      verified = true;

      // Mark code as used
      await db
        .update(emailVerificationCodes)
        .set({ isUsed: 1 })
        .where(eq(emailVerificationCodes.id, emailCode.id));
    }

    if (!verified) {
      // Log failed 2FA attempt
      await db.insert(activityLogs).values({
        userId: user.id,
        action: "2fa_verification_failed",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { method },
        severity: "warning",
      });

      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 401 }
      );
    }

    // 2FA verified - generate access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const tokenHash = hashToken(accessToken);

    // Create session
    await db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

    // Update last login
    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Log successful 2FA verification
    await db.insert(activityLogs).values({
      userId: user.id,
      action: "2fa_verification_success",
      resource: "users",
      resourceId: user.id,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { method },
      severity: "info",
    });

    const response = NextResponse.json({
      message: "2FA verification successful",
      token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled === 1,
      },
    });

    // Set HttpOnly session cookie so the token is never exposed to JavaScript (XSS-safe)
    // Always secure=true — Replit serves over HTTPS in both dev and prod.
    // sameSite:"none" is required so the cookie is sent when the app is embedded
    // in an iframe (e.g. the Replit preview pane). secure:true is mandatory with none.
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 24 * 60 * 60, // 24 hours
    });

    return response;

  } catch (error) {
    console.error("2FA verification error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
