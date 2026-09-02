import { NextResponse } from "next/server";
import { systemDb } from "@/lib/db";
import { sessions, activityLogs } from "@/shared/schema";
import { verifyToken, hashToken } from "@/lib/auth";
import { AUTH_COOKIE_NAME, getTokenFromRequest } from "@/lib/api/auth";
import { clearCsrfCookie, requireCookieCsrf } from "@/lib/csrf";
import { eq } from "drizzle-orm";

// Build a success response that always clears the auth cookie.
function loggedOutResponse() {
  const response = NextResponse.json({ message: "Logged out successfully" });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
  clearCsrfCookie(response);
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
    const bearer = req.headers.get("authorization")?.slice(7).trim();
    if (!bearer || bearer !== token) requireCookieCsrf(req);

    const tokenHash = hashToken(token);

    // Terminate session: set both isActive=0 and forceLogoutAt for consistency with force-logout.
    await systemDb
      .update(sessions)
      .set({ isActive: 0, forceLogoutAt: new Date() })
      .where(eq(sessions.tokenHash, tokenHash));

    // Log logout activity
    await systemDb.insert(activityLogs).values({
      userId: payload.userId,
      action: "logout",
      resource: "users",
      resourceId: payload.userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      severity: "info",
    });

    return loggedOutResponse();

  } catch (error: any) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: error?.statusCode || 500 }
    );
  }
}
