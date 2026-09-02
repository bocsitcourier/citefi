import { NextResponse } from "next/server";
import { getTxDb, systemDb } from "@/lib/db";
import { users, sessions, activityLogs, totpSecrets, loginChallenges } from "@/shared/schema";
import { generateAccessToken, hashToken, verifyTOTPToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { issueCsrfCookie } from "@/lib/csrf";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, gt, isNull, sql } from "drizzle-orm";
import { enterSystemContext } from "@/lib/tenant-context";
import crypto from "crypto";

function hashesMatch(value: string, expected: string): boolean {
  const actual = Buffer.from(hashToken(value));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

export async function POST(req: Request) {
  enterSystemContext("pre-session two-factor verification");
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`2fa-verify:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) return NextResponse.json(
      { error: "Too many verification attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );

    const { code, challengeToken } = await req.json();
    if (!code || !challengeToken) {
      return NextResponse.json({ error: "code and challengeToken are required; legacy challenges are no longer supported" }, { status: 400 });
    }

    const [challenge] = await systemDb.select().from(loginChallenges).where(and(
      eq(loginChallenges.tokenHash, hashToken(String(challengeToken))),
      isNull(loginChallenges.consumedAt),
      gt(loginChallenges.expiresAt, new Date())
    )).limit(1);
    if (!challenge) return NextResponse.json(
      { error: "Invalid or expired login session. Please log in again." },
      { status: 401 }
    );
    if (challenge.attempts >= 5) {
      return NextResponse.json({ error: "Too many verification attempts. Please log in again." }, { status: 429 });
    }

    const [user] = await systemDb.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    if (!user || user.accountStatus !== "active" || user.twoFactorEnabled !== 1 ||
        user.twoFactorMethod !== challenge.method) {
      return NextResponse.json({ error: "Two-factor login is no longer authorized. Please log in again." }, { status: 401 });
    }

    const userRl = await rateLimitDb(`2fa-verify:user:${user.id}`, 5, 15 * 60 * 1000);
    if (!userRl.allowed) return NextResponse.json(
      { error: "Too many verification attempts for this account. Please try again later." },
      { status: 429, headers: { "Retry-After": String(userRl.retryAfter) } }
    );

    let verified = false;
    if (challenge.method === "totp") {
      const [totp] = await systemDb.select().from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id)).limit(1);
      verified = !!totp && verifyTOTPToken(String(code), totp.secret);
    } else if (challenge.method === "email" && challenge.emailCodeHash) {
      verified = hashesMatch(String(code), challenge.emailCodeHash);
    }

    if (!verified) {
      await systemDb.update(loginChallenges)
        .set({ attempts: sql`${loginChallenges.attempts} + 1` })
        .where(and(eq(loginChallenges.id, challenge.id), isNull(loginChallenges.consumedAt)));
      return NextResponse.json({ error: "Invalid verification code" }, { status: 401 });
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email, role: user.role });
    const now = new Date();
    const won = await getTxDb().transaction(async (tx) => {
      // This conditional update both revalidates current account/2FA state and
      // row-locks the user until commit, preventing a concurrent disable or
      // suspension from racing session issuance.
      const [stillAuthorized] = await tx.update(users).set({
        failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now,
      }).where(and(
        eq(users.id, user.id), eq(users.accountStatus, "active"),
        eq(users.twoFactorEnabled, 1), eq(users.twoFactorMethod, challenge.method)
      )).returning({ id: users.id });
      if (!stillAuthorized) return false;
      const [consumed] = await tx.update(loginChallenges).set({ consumedAt: now }).where(and(
        eq(loginChallenges.id, challenge.id),
        isNull(loginChallenges.consumedAt),
        gt(loginChallenges.expiresAt, now)
      )).returning({ id: loginChallenges.id });
      if (!consumed) return false;
      await tx.insert(sessions).values({
        userId: user.id, tokenHash: hashToken(accessToken),
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1, teamContextId: user.defaultTeamId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      if (challenge.method === "totp") {
        await tx.update(totpSecrets).set({ lastUsedAt: now }).where(eq(totpSecrets.userId, user.id));
      }
      return true;
    });
    if (!won) return NextResponse.json({ error: "Login challenge has already been used" }, { status: 401 });

    await systemDb.insert(activityLogs).values({
      userId: user.id, action: "2fa_verification_success", resource: "users",
      resourceId: user.id, ipAddress: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { method: challenge.method }, severity: "info",
    });
    const response = NextResponse.json({
      message: "2FA verification successful",
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, twoFactorEnabled: true },
    });
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 24 * 60 * 60,
    });
    issueCsrfCookie(response);
    return response;
  } catch (error) {
    console.error("2FA verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}