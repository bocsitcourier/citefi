import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, activityLogs } from "@/shared/schema";
import { verifyToken, hashToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    
    // Allow logout even without valid token - just clear client-side
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({
        message: "Logged out successfully",
      });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    // If token is invalid/expired, still return success (session already gone)
    if (!payload) {
      return NextResponse.json({
        message: "Logged out successfully",
      });
    }

    const tokenHash = hashToken(token);

    // Deactivate session
    await db
      .update(sessions)
      .set({ isActive: 0 })
      .where(eq(sessions.tokenHash, tokenHash));

    // Log logout activity
    await db.insert(activityLogs).values({
      userId: payload.userId,
      action: "logout",
      resource: "users",
      resourceId: payload.userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      severity: "info",
    });

    return NextResponse.json({
      message: "Logged out successfully",
    });

  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
