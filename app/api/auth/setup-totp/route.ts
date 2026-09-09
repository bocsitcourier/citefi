import { NextRequest, NextResponse } from "next/server";
import { systemDb } from "@/lib/db";
import { users, sessions, totpSecrets, activityLogs, loginChallenges } from "@/shared/schema";
import {
  generateTOTPSecret,
  generateBackupCodes,
  hashBackupCodes,
  verifyPassword,
  generateTOTPSetupToken,
  verifyTOTPSetupToken,
  verifyTOTPTokenCounter,
  hashToken,
} from "@/lib/auth";
import { decryptTOTPSecret, encryptTOTPSecret } from "@/lib/totp-security";
import { verifyToken } from "@/lib/api/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { and, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`totp-setup:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many TOTP setup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);

    if (!authResult) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid or expired session" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action, verificationCode } = body;
    if (action === "verify") {
      const userRl = await rateLimitDb(
        `totp-setup:user:${authResult.userId}`,
        8,
        15 * 60 * 1000,
      );
      if (!userRl.allowed) {
        return NextResponse.json(
          { error: "Too many authenticator verification attempts. Start again later." },
          { status: 429, headers: { "Retry-After": String(userRl.retryAfter) } },
        );
      }
    }

    if (action === "generate") {
      const [user] = await systemDb
        .select({
          id: users.id,
          email: users.email,
          passwordHash: users.passwordHash,
          accountStatus: users.accountStatus,
          twoFactorEnabled: users.twoFactorEnabled,
          twoFactorMethod: users.twoFactorMethod,
        })
        .from(users)
        .where(eq(users.id, authResult.userId))
        .limit(1);

      if (!user || user.accountStatus !== "active") {
        return NextResponse.json(
          { error: "Account is not active" },
          { status: 403 }
        );
      }
      if (!body.currentPassword || !user.passwordHash ||
          !(await verifyPassword(String(body.currentPassword), user.passwordHash))) {
        return NextResponse.json(
          { error: "Current password is required to enable two-factor authentication" },
          { status: 401 }
        );
      }

      const [existingFactor] = await systemDb
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id))
        .limit(1);
      const factorVersion = existingFactor?.credentialVersion ?? 0;
      let replacementCounter: number | null = null;
      if (user.twoFactorEnabled === 1) {
        if (user.twoFactorMethod !== "totp" || !existingFactor) {
          return NextResponse.json({ error: "Existing two-factor method must be reset before enrollment" }, { status: 409 });
        }
        const currentSecret = decryptTOTPSecret(
          existingFactor.secretCiphertext,
          existingFactor.secretKeyVersion,
          existingFactor.secret,
        );
        replacementCounter = verifyTOTPTokenCounter(String(body.currentTotpCode || ""), currentSecret);
        if (replacementCounter === null) {
          return NextResponse.json(
            { error: "A current authenticator code is required to replace this authenticator" },
            { status: 401 },
          );
        }
      }

      const totpSetup = await generateTOTPSecret(user.email);
      const setupToken = generateTOTPSetupToken(
        user.id,
        totpSetup.secret,
        authResult.sessionId,
        factorVersion,
        user.passwordHash,
      );
      const now = new Date();
      const prepared = await systemDb.transaction(async (tx) => {
        const [active] = await tx.update(users)
          .set({ updatedAt: sql`${users.updatedAt}` })
          .where(and(eq(users.id, user.id), eq(users.accountStatus, "active")))
          .returning({ id: users.id });
        if (!active) return false;

        if (existingFactor && replacementCounter !== null) {
          const [consumedCurrentFactor] = await tx.update(totpSecrets)
            .set({ lastUsedAt: now, lastUsedCounter: replacementCounter })
            .where(and(
              eq(totpSecrets.userId, user.id),
              eq(totpSecrets.credentialVersion, factorVersion),
              or(
                isNull(totpSecrets.lastUsedCounter),
                lt(totpSecrets.lastUsedCounter, replacementCounter),
              ),
            ))
            .returning({ id: totpSecrets.id });
          if (!consumedCurrentFactor) return false;
        }

        await tx.update(loginChallenges)
          .set({ consumedAt: now })
          .where(and(
            eq(loginChallenges.userId, user.id),
            eq(loginChallenges.method, "totp_setup"),
            isNull(loginChallenges.consumedAt),
          ));
        await tx.insert(loginChallenges).values({
          userId: user.id,
          tokenHash: hashToken(setupToken),
          method: "totp_setup",
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        });
        return true;
      });
      if (!prepared) {
        return NextResponse.json({ error: "Security settings changed. Start again." }, { status: 409 });
      }

      return NextResponse.json({
        qrCodeUrl: totpSetup.qrCodeUrl,
        manualEntryKey: totpSetup.manualEntryKey,
        setupToken,
      }, { headers: { "Cache-Control": "no-store" } });

    } else if (action === "verify") {
      const setup = verifyTOTPSetupToken(String(body.setupToken || ""));

      if (
        !setup ||
        setup.userId !== authResult.userId ||
        setup.sessionId !== authResult.sessionId ||
        !verificationCode
      ) {
        return NextResponse.json(
          { error: "The authenticator setup has expired. Start again." },
          { status: 400 }
        );
      }

      const acceptedCounter = verifyTOTPTokenCounter(String(verificationCode), setup.secret);

      if (acceptedCounter === null) {
        const attemptedAt = new Date();
        const [attempt] = await systemDb.update(loginChallenges)
          .set({
            attempts: sql`${loginChallenges.attempts} + 1`,
            consumedAt: sql`CASE
              WHEN ${loginChallenges.attempts} + 1 >= 5 THEN ${attemptedAt}
              ELSE ${loginChallenges.consumedAt}
            END`,
          })
          .where(and(
            eq(loginChallenges.userId, authResult.userId),
            eq(loginChallenges.tokenHash, hashToken(String(body.setupToken))),
            eq(loginChallenges.method, "totp_setup"),
            isNull(loginChallenges.consumedAt),
            gt(loginChallenges.expiresAt, attemptedAt),
          ))
          .returning({ attempts: loginChallenges.attempts });
        return NextResponse.json(
          {
            error: attempt && attempt.attempts >= 5
              ? "Too many invalid codes. Start authenticator setup again."
              : "Invalid verification code",
          },
          { status: attempt && attempt.attempts >= 5 ? 429 : 401 }
        );
      }

      const backupCodes = await generateBackupCodes(10);
      const hashedBackupCodes = await hashBackupCodes(backupCodes);
      const encrypted = encryptTOTPSecret(setup.secret);
      const now = new Date();
      const outcome = await systemDb.transaction(async (tx) => {
        const [activeUser] = await tx.update(users)
          .set({ updatedAt: sql`${users.updatedAt}` })
          .where(and(eq(users.id, authResult.userId), eq(users.accountStatus, "active")))
          .returning({
            id: users.id,
            passwordHash: users.passwordHash,
            twoFactorEnabled: users.twoFactorEnabled,
            twoFactorMethod: users.twoFactorMethod,
          });
        if (!activeUser?.passwordHash || hashToken(activeUser.passwordHash) !== setup.passwordBinding) {
          return "credentials_changed" as const;
        }

        const [currentFactor] = await tx.select({
          credentialVersion: totpSecrets.credentialVersion,
        }).from(totpSecrets).where(eq(totpSecrets.userId, authResult.userId)).limit(1);
        if ((currentFactor?.credentialVersion ?? 0) !== setup.factorVersion) {
          return "factor_changed" as const;
        }

        const [consumedSetup] = await tx.update(loginChallenges)
          .set({ consumedAt: now })
          .where(and(
            eq(loginChallenges.userId, authResult.userId),
            eq(loginChallenges.tokenHash, hashToken(String(body.setupToken))),
            eq(loginChallenges.method, "totp_setup"),
            isNull(loginChallenges.consumedAt),
            gt(loginChallenges.expiresAt, now),
            lt(loginChallenges.attempts, 5),
          ))
          .returning({ id: loginChallenges.id });
        if (!consumedSetup) return "challenge_used" as const;

        await tx.insert(totpSecrets).values({
          userId: authResult.userId,
          secret: "encrypted",
          secretCiphertext: encrypted.ciphertext,
          secretKeyVersion: encrypted.keyVersion,
          backupCodes: hashedBackupCodes,
          credentialVersion: setup.factorVersion + 1,
          lastUsedAt: now,
          lastUsedCounter: acceptedCounter,
        }).onConflictDoUpdate({
          target: totpSecrets.userId,
          set: {
            secret: "encrypted",
            secretCiphertext: encrypted.ciphertext,
            secretKeyVersion: encrypted.keyVersion,
            backupCodes: hashedBackupCodes,
            credentialVersion: setup.factorVersion + 1,
            lastUsedAt: now,
            lastUsedCounter: acceptedCounter,
          },
        });
        await tx.update(users).set({
          twoFactorEnabled: 1,
          twoFactorMethod: "totp",
        }).where(eq(users.id, authResult.userId));
        await tx.update(sessions).set({
          isActive: 0,
          forceLogoutAt: now,
          terminationReason: "Two-factor authentication enabled",
        }).where(and(
          eq(sessions.userId, authResult.userId),
          ne(sessions.id, authResult.sessionId),
        ));
        await tx.update(sessions).set({
          authAssurance: "mfa",
          mfaVerifiedAt: now,
        }).where(and(
          eq(sessions.id, authResult.sessionId),
          eq(sessions.userId, authResult.userId),
          eq(sessions.isActive, 1),
        ));
        await tx.insert(activityLogs).values({
          userId: authResult.userId,
          action: "totp_setup",
          resource: "users",
          resourceId: authResult.userId,
          ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
          userAgent: req.headers.get("user-agent") || null,
          details: { otherSessionsRevoked: true },
          severity: "info",
        });
        return "ok" as const;
      });
      if (outcome !== "ok") {
        const message = outcome === "challenge_used"
          ? "The authenticator setup has expired or already been used."
          : "Security settings changed. Start authenticator setup again.";
        return NextResponse.json({ error: message }, { status: 409 });
      }

      return NextResponse.json({
        message: "TOTP setup successful",
        backupCodes,
      }, { headers: { "Cache-Control": "no-store" } });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'generate' or 'verify'" },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error("TOTP setup error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
