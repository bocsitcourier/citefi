import { NextResponse } from "next/server";
import crypto from "crypto";
import { getTxDb } from "@/lib/db";
import { users, sessions, activityLogs, loginChallenges } from "@/shared/schema";
import { verifyPassword, generateAccessToken, hashToken, isAccountLocked, calculateLockoutDuration, generateEmailCode } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { issueCsrfCookie } from "@/lib/csrf";
import { sendEmailVerificationCode } from "@/lib/email";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, isNull, sql } from "drizzle-orm";
import { enterSystemContext } from "@/lib/tenant-context";
import { sessionExpiry, sessionLifetimeSeconds } from "@/lib/session-policy";

export async function POST(req: Request) {
  enterSystemContext("public login and session creation");
  try {
    // Rate limit by IP: 10 login attempts per 15 minutes
    const ip = getClientIp(req);
    const limit = await rateLimitDb(`login:${ip}`, 10, 15 * 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
      );
    }

    const body = await req.json();
    const { email, password } = body;
    const rememberMe = body.rememberMe === true;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find user
    const [user] = await getTxDb()
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (!user) {
      // Log failed login attempt (no user found)
      await getTxDb().insert(activityLogs).values({
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
      
      await getTxDb().insert(activityLogs).values({
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
      await getTxDb().insert(activityLogs).values({
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
    const observedPasswordHash = user.passwordHash;
    if (!observedPasswordHash || !(await verifyPassword(password, observedPasswordHash))) {
      // Increment failed login attempts
      const [failed] = observedPasswordHash
        ? await getTxDb()
            .update(users)
            .set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` })
            .where(and(eq(users.id, user.id), eq(users.passwordHash, observedPasswordHash)))
            .returning({ failedLoginAttempts: users.failedLoginAttempts })
        : [];
      const newFailedAttempts = failed?.failedLoginAttempts ?? (user.failedLoginAttempts || 0) + 1;
      const lockoutDuration = calculateLockoutDuration(newFailedAttempts);
      const lockedUntil = lockoutDuration > 0 ? new Date(Date.now() + lockoutDuration) : null;
      if (lockedUntil && observedPasswordHash) {
        await getTxDb().update(users).set({ lockedUntil }).where(and(
          eq(users.id, user.id),
          eq(users.passwordHash, observedPasswordHash),
        ));
      }

      await getTxDb().insert(activityLogs).values({
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
    const passwordHash = observedPasswordHash;

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      const method = user.twoFactorMethod;
      if (method !== "totp" && method !== "email") {
        return NextResponse.json({ error: "Two-factor authentication is misconfigured" }, { status: 409 });
      }
      // The remembered-session choice is bound into the opaque challenge.
      // Any client modification changes the stored hash and invalidates it.
      const challengeToken = `${crypto.randomBytes(32).toString("base64url")}.${rememberMe ? "1" : "0"}`;
      const emailCode = method === "email" ? generateEmailCode() : null;
      const challengeCreated = await getTxDb().transaction(async (tx) => {
        const [stillEligible] = await tx.update(users)
          .set({ updatedAt: sql`${users.updatedAt}` })
          .where(and(
            eq(users.id, user.id),
            eq(users.passwordHash, passwordHash),
            eq(users.accountStatus, "active"),
            eq(users.twoFactorEnabled, 1),
            eq(users.twoFactorMethod, method),
          ))
          .returning({ id: users.id });
        if (!stillEligible) return false;
        // A new completed password step supersedes older outstanding attempts.
        await tx.update(loginChallenges).set({ consumedAt: new Date() }).where(and(
          eq(loginChallenges.userId, user.id),
          isNull(loginChallenges.consumedAt)
        ));
        await tx.insert(loginChallenges).values({
          userId: user.id,
          tokenHash: hashToken(challengeToken),
          method,
          emailCodeHash: emailCode ? hashToken(emailCode) : null,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5-minute window
        });
        return true;
      });
      if (!challengeCreated) {
        return NextResponse.json(
          { error: "Security settings changed during login. Please try again." },
          { status: 409 },
        );
      }

      if (emailCode) {
        try {
          await sendEmailVerificationCode({
            to: user.email,
            code: emailCode,
            purpose: "login_2fa",
            fullName: user.fullName,
          });
        } catch (emailError) {
          console.error("Failed to deliver login verification email:", emailError);
          return NextResponse.json({ error: "Failed to send verification email. Please try again." }, { status: 503 });
        }
      }

      return NextResponse.json({
        requiresTwoFactor: true,
        twoFactorMethod: method,
        challengeToken,
        message: "Please complete 2FA verification",
      });
    }

    // No 2FA required - generate full access token
    const lifetimeSeconds = sessionLifetimeSeconds(rememberMe);
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    }, lifetimeSeconds);

    const tokenHash = hashToken(accessToken);

    const now = new Date();
    const sessionCreated = await getTxDb().transaction(async (tx) => {
      const [stillEligible] = await tx.update(users)
        .set({
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastLoginAt: now,
        })
        .where(and(
          eq(users.id, user.id),
          eq(users.passwordHash, passwordHash),
          eq(users.accountStatus, "active"),
          eq(users.twoFactorEnabled, 0),
        ))
        .returning({ id: users.id });
      if (!stillEligible) return false;
      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1,
        teamContextId: user.defaultTeamId,
        expiresAt: sessionExpiry(rememberMe),
        deviceInfo: { rememberedSession: rememberMe },
        authAssurance: "password",
        mfaVerifiedAt: null,
      });
      await tx.insert(activityLogs).values({
        userId: user.id,
        action: "login_success",
        resource: "users",
        resourceId: user.id,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: { email, rememberedSession: rememberMe },
        severity: "info",
      });
      return true;
    });
    if (!sessionCreated) {
      return NextResponse.json(
        { error: "Security settings changed during login. Please try again." },
        { status: 409 },
      );
    }

    const response = NextResponse.json({
      message: "Login successful",
      ...(process.env.NODE_ENV === "development" ? { previewToken: accessToken } : {}),
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
      maxAge: lifetimeSeconds,
    });
    issueCsrfCookie(response, lifetimeSeconds);

    return response;

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
