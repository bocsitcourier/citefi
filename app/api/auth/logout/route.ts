import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, activityLogs } from "@/shared/schema";
import { verifyToken, hashToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME, getTokenFromRequest } from "@/lib/api/auth";
import { eq } from "drizzle-orm";

// Build a success response that always clears the auth cookie.
function loggedOutResponse() {
  const response = NextResponse.json({ message: "Logged out successfully" });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function POST(req: Request) {
  try {
    const token = getTokenFromRequest(req);

    // Allow logout even without valid token - just clear the cookie client-side
    if (!token) {
      return loggedOutResponse();
    }

    const payload = verifyToken(token);

    // If token is invalid/expired, still return success (session already gone)
    if (!payload) {
      return loggedOutResponse();
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

    return loggedOutResponse();

  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
