import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, totpSecrets, activityLogs } from "@/shared/schema";
import { verifyToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const payload = verifyToken(authHeader.substring(7));
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await db.delete(totpSecrets).where(eq(totpSecrets.userId, payload.userId));
    await db.update(users)
      .set({ twoFactorEnabled: 0, twoFactorMethod: null })
      .where(eq(users.id, payload.userId));

    await db.insert(activityLogs).values({
      userId: payload.userId,
      action: "totp_disabled",
      resource: "users",
      resourceId: payload.userId,
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
