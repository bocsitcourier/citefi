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

    // Fetch user first — needed for TOTP secret lookup and session creation.
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Step 1: Validate the 2FA code BEFORE consuming the challenge token.
    //
    // With the old order (consume challenge → validate code), a wrong TOTP digit
    // would burn the challenge and force the user to restart the entire login flow.
    // By validating first, a typo lets the user retry within the 5-minute window.
    //
    // Concurrency: two requests that both pass code validation then race to consume
    // the challenge; only one wins — the other gets 0 rows back and returns 401.
    // This is the correct serialisation behaviour.
    let verified = false;

    if (method === "totp") {
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
        await db
          .update(totpSecrets)
          .set({ lastUsedAt: new Date() })
          .where(eq(totpSecrets.userId, userId));
      }
    } else if (method === "email") {
      // Atomically validate + consume the email code in a single conditional UPDATE.
      const [emailCode] = await db
        .select()
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.userId, userId),
            eq(emailVerificationCodes.code, code),
            eq(emailVerificationCodes.purpose, "login_2fa"),
            eq(emailVerificationCodes.isUsed, 0),
            gt(emailVerificationCodes.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!emailCode) {
        return NextResponse.json(
          { error: "Invalid or expired verification code" },
          { status: 401 }
        );
      }

      if (emailCode.attempts >= 5) {
        return NextResponse.json(
          { error: "Too many verification attempts" },
          { status: 429 }
        );
      }

      await db
        .update(emailVerificationCodes)
        .set({ isUsed: 1, attempts: emailCode.attempts + 1 })
        .where(
          and(
            eq(emailVerificationCodes.id, emailCode.id),
            eq(emailVerificationCodes.isUsed, 0)
          )
        );

      verified = true;
    }

    if (!verified) {
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

      // Challenge token is NOT consumed here — the user can retry with the
      // correct code without needing to log in again (within the 5-min window).
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 401 }
      );
    }

    // Step 2: Code is confirmed valid — now atomically consume the challenge token.
    // Using a single conditional UPDATE prevents two concurrent successful requests
    // from both creating sessions off the same login challenge.
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

    // 2FA verified — generate access token and create session.
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    const tokenHash = hashToken(accessToken);

    await db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

    await db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      })
      .where(eq(users.id, user.id));

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
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        twoFactorEnabled: user.twoFactorEnabled === 1,
      },
    });

    // HttpOnly session cookie — XSS-safe; secure+sameSite:none required for
    // Replit iframe embedding (dev preview pane uses a cross-origin iframe).
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
      maxAge: 24 * 60 * 60,
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
