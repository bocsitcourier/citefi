import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, totpSecrets, activityLogs } from "@/shared/schema";
import { verifyToken } from "@/lib/api/auth";
import { rateLimitDb, getClientIp } from "@/lib/db-rate-limit";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await rateLimitDb(`totp-disable:${ip}`, 3, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const authResult = await verifyToken(req);
    if (!authResult) {
      return NextResponse.json({ error: "Unauthorized - Invalid or expired session" }, { status: 401 });
    }

    await db.delete(totpSecrets).where(eq(totpSecrets.userId, authResult.userId));
    await db.update(users)
      .set({ twoFactorEnabled: 0, twoFactorMethod: null })
      .where(eq(users.id, authResult.userId));

    await db.insert(activityLogs).values({
      userId: authResult.userId,
      action: "totp_disabled",
      resource: "users",
      resourceId: authResult.userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      severity: "warning",
    });

    return NextResponse.json({ message: "Two-factor authentication disabled" });
  } catch (error) {
    console.error("Disable TOTP error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
