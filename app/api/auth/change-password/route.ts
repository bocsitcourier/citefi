import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, activityLogs } from "@/shared/schema";
import { hashPassword, verifyPassword, validatePassword } from "@/lib/auth";
import { verifyToken } from "@/lib/api/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`change-password:${ip}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many password change attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);
    if (!authResult) {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }

    const { currentPassword, newPassword } = await req.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current password and new password are required" },
        { status: 400 }
      );
    }

    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.errors.join(". ") },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from your current password" },
        { status: 400 }
      );
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, authResult.userId))
      .limit(1);

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      );
    }

    const hashedPassword = await hashPassword(newPassword);
    await db
      .update(users)
      .set({ passwordHash: hashedPassword })
      .where(eq(users.id, user.id));

    await db.insert(activityLogs).values({
      userId: user.id,
      action: "password_changed",
      resource: "users",
      resourceId: user.id,
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      userAgent: req.headers.get("user-agent") || null,
      details: { email: user.email },
      severity: "info",
    });

    return NextResponse.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
