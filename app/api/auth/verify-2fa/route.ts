import { NextResponse } from "next/server";
import { getTxDb, systemDb } from "@/lib/db";
import { users, sessions, activityLogs, totpSecrets, loginChallenges } from "@/shared/schema";
import {
  findBackupCodeIndex,
  generateAccessToken,
  hashToken,
  verifyTOTPTokenCounter,
} from "@/lib/auth";
import { decryptTOTPSecret } from "@/lib/totp-security";
import { AUTH_COOKIE_NAME } from "@/lib/api/auth";
import { issueCsrfCookie } from "@/lib/csrf";
import { deliverEmail } from "@/lib/email";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, gt, isNull, lt, or, sql } from "drizzle-orm";
import { enterSystemContext } from "@/lib/tenant-context";
import crypto from "crypto";
import { sessionExpiry, sessionLifetimeSeconds } from "@/lib/session-policy";

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

    // The login route bound this choice into the hashed challenge token.
    const rememberMe = String(challengeToken).endsWith(".1");
    const lifetimeSeconds = sessionLifetimeSeconds(rememberMe);
    const accessToken = generateAccessToken(
      { userId: user.id, email: user.email, role: user.role },
      lifetimeSeconds,
    );
    const now = new Date();
    const codeValue = String(code).trim();
    const result = await getTxDb().transaction(async (tx) => {
      // This conditional update both revalidates current account/2FA state and
      // row-locks the user until commit, preventing a concurrent disable or
      // suspension from racing session issuance.
      const [stillAuthorized] = await tx.update(users).set({
        failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now,
      }).where(and(
        eq(users.id, user.id), eq(users.accountStatus, "active"),
        eq(users.twoFactorEnabled, 1), eq(users.twoFactorMethod, challenge.method)
      )).returning({ id: users.id });
      if (!stillAuthorized) return { status: "unauthorized" as const };

      let factorUsed: "totp" | "recovery_code" | "email" | null = null;
      let totpCounter: number | null = null;
      let recoveryIndex: number | null = null;
      let factor: typeof totpSecrets.$inferSelect | undefined;
      if (challenge.method === "totp") {
        [factor] = await tx.select().from(totpSecrets)
          .where(eq(totpSecrets.userId, user.id))
          .limit(1);
        if (factor) {
          const secret = decryptTOTPSecret(
            factor.secretCiphertext,
            factor.secretKeyVersion,
            factor.secret,
          );
          totpCounter = verifyTOTPTokenCounter(codeValue, secret);
          if (
            totpCounter !== null &&
            (factor.lastUsedCounter === null || totpCounter > factor.lastUsedCounter)
          ) {
            factorUsed = "totp";
          } else {
            const hashes = Array.isArray(factor.backupCodes)
              ? factor.backupCodes.filter((value): value is string => typeof value === "string")
              : [];
            recoveryIndex = await findBackupCodeIndex(codeValue, hashes);
            if (recoveryIndex !== null) factorUsed = "recovery_code";
          }
        }
      } else if (challenge.method === "email" && challenge.emailCodeHash) {
        if (hashesMatch(codeValue, challenge.emailCodeHash)) factorUsed = "email";
      }

      if (!factorUsed) {
        await tx.update(loginChallenges)
          .set({ attempts: sql`${loginChallenges.attempts} + 1` })
          .where(and(eq(loginChallenges.id, challenge.id), isNull(loginChallenges.consumedAt)));
        return { status: "invalid" as const };
      }

      const [consumed] = await tx.update(loginChallenges).set({ consumedAt: now }).where(and(
        eq(loginChallenges.id, challenge.id),
        isNull(loginChallenges.consumedAt),
        gt(loginChallenges.expiresAt, now)
      )).returning({ id: loginChallenges.id });
      if (!consumed) return { status: "used" as const };

      if (factorUsed === "totp" && factor && totpCounter !== null) {
        const [accepted] = await tx.update(totpSecrets)
          .set({ lastUsedAt: now, lastUsedCounter: totpCounter })
          .where(and(
            eq(totpSecrets.userId, user.id),
            eq(totpSecrets.credentialVersion, factor.credentialVersion),
            or(isNull(totpSecrets.lastUsedCounter), lt(totpSecrets.lastUsedCounter, totpCounter)),
          ))
          .returning({ id: totpSecrets.id });
        if (!accepted) return { status: "used" as const };
      } else if (factorUsed === "recovery_code" && factor && recoveryIndex !== null) {
        const hashes = Array.isArray(factor.backupCodes)
          ? factor.backupCodes.filter((value): value is string => typeof value === "string")
          : [];
        const remainingCodes = hashes.filter((_, index) => index !== recoveryIndex);
        const [accepted] = await tx.update(totpSecrets)
          .set({ backupCodes: remainingCodes, lastUsedAt: now })
          .where(and(
            eq(totpSecrets.userId, user.id),
            eq(totpSecrets.credentialVersion, factor.credentialVersion),
          ))
          .returning({ id: totpSecrets.id });
        if (!accepted) return { status: "used" as const };
      }

      await tx.insert(sessions).values({
        userId: user.id, tokenHash: hashToken(accessToken),
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        isActive: 1, teamContextId: user.defaultTeamId,
        expiresAt: sessionExpiry(rememberMe),
        deviceInfo: { rememberedSession: rememberMe, factorUsed },
        authAssurance: "mfa",
        mfaVerifiedAt: now,
      });
      return { status: "ok" as const, factorUsed };
    });
    if (result.status !== "ok") {
      const message = result.status === "invalid"
        ? "Invalid verification or recovery code"
        : "Login challenge has already been used";
      return NextResponse.json({ error: message }, { status: 401 });
    }

    await systemDb.insert(activityLogs).values({
      userId: user.id, action: "2fa_verification_success", resource: "users",
      resourceId: user.id, ipAddress: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        method: challenge.method,
        factorUsed: result.factorUsed,
        rememberedSession: rememberMe,
      },
      severity: result.factorUsed === "recovery_code" ? "warning" : "info",
    });
    if (result.factorUsed === "recovery_code") {
      deliverEmail({
        to: user.email,
        subject: "A Citefi recovery code was used",
        text: [
          "A one-time recovery code was used to sign in to your Citefi account.",
          "",
          "If this was not you, reset your password and revoke active sessions immediately.",
        ].join("\n"),
      }).catch((error) => console.error("[auth] recovery-code security email failed:", error));
    }
    const response = NextResponse.json({
      message: "2FA verification successful",
      ...(process.env.NODE_ENV === "development" ? { previewToken: accessToken } : {}),
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, twoFactorEnabled: true },
    });
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: lifetimeSeconds,
    });
    issueCsrfCookie(response, lifetimeSeconds);
    return response;
  } catch (error) {
    console.error("2FA verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}