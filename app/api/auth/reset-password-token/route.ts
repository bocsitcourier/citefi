import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResets, activityLogs } from "@/shared/schema";
import { hashToken, hashPassword } from "@/lib/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq, and, lt, ne, gt } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`reset-token-validate:${ip}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token");

    if (!token || token.length < 32) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    const [reset] = await db
      .select({
        id: passwordResets.id,
        userId: passwordResets.userId,
        status: passwordResets.status,
        expiresAt: passwordResets.expiresAt,
      })
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          eq(passwordResets.status, "pending")
        )
      )
      .limit(1);

    if (!reset || reset.expiresAt <= now) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, reset.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
    }

    return NextResponse.json({ valid: true, email: user.email });
  } catch (error) {
    console.error("[reset-password-token GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`reset-token-apply:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await req.json();
    const { token, newPassword } = body;

    if (!token || !newPassword) {
      return NextResponse.json({ error: "Token and new password are required" }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    // Atomically consume the reset token in a single conditional UPDATE.
    // A two-step SELECT → UPDATE pattern allows two concurrent requests to both
    // read status='pending' before either marks it used, enabling a race where
    // both requests successfully reset the password to different values.
    // A single UPDATE with all predicates in the WHERE clause ensures only one
    // concurrent request can win; the other gets 0 rows back.
    const [consumed] = await db
      .update(passwordResets)
      .set({ status: "used", usedAt: now })
      .where(
        and(
          eq(passwordResets.tokenHash, tokenHash),
          eq(passwordResets.status, "pending"),
          gt(passwordResets.expiresAt, now)
        )
      )
      .returning({ userId: passwordResets.userId, id: passwordResets.id });

    if (!consumed) {
      return NextResponse.json({ error: "Invalid or expired link. Please request a new one." }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);

    await db.update(users).set({ passwordHash }).where(eq(users.id, consumed.userId));

    // Cancel any other pending resets for this user (e.g. multiple forgot-password clicks)
    await db
      .update(passwordResets)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(passwordResets.userId, consumed.userId),
          eq(passwordResets.status, "pending"),
          ne(passwordResets.id, consumed.id)
        )
      );

    await db.insert(activityLogs).values({
      userId: consumed.userId,
      action: "password_reset_completed",
      resource: "users",
      resourceId: consumed.userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { resetType: "token_link" },
      severity: "info",
    });

    return NextResponse.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("[reset-password-token POST]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
