import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, teamMembers } from "@/shared/schema";
import { verifyToken as verifyJWT, hashToken } from "@/lib/auth";
import { eq, and, isNull, gt } from "drizzle-orm";

export interface AuthenticatedUser {
  id: number;
  email: string;
  role: "admin" | "team_member";
  accountStatus: string;
  teamId: number | null; // Multi-tenant team context
}

export const AUTH_COOKIE_NAME = "auth_token";

/**
 * Extract the auth token from a request, preferring a valid Authorization
 * Bearer header but falling back to the HttpOnly `auth_token` cookie.
 * Bogus header values ("null"/"undefined"/empty) are ignored so legacy
 * client code that sends `Bearer null` still authenticates via the cookie.
 * Works for both NextRequest and the standard Request (reads the cookie header).
 */
export function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const t = authHeader.slice(7).trim();
    if (t && t !== "null" && t !== "undefined") return t;
  }

  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim();
      if (key === AUTH_COOKIE_NAME) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
  }

  return null;
}

/**
 * Verify JWT token and return authenticated user
 * Throws error if token is invalid or user not found
 */
export async function getAuthenticatedUser(req: NextRequest): Promise<AuthenticatedUser> {
  // Get token from Authorization header or HttpOnly cookie
  const token = getTokenFromRequest(req);

  if (!token) {
    throw new Error("No authentication token provided");
  }

  // Verify JWT
  const payload = verifyJWT(token);
  if (!payload) {
    throw new Error("Invalid or expired token");
  }

  // Load user from database
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  // Check if account is active
  if (user.accountStatus !== "active") {
    throw new Error("Account is not active");
  }

  // CRITICAL: Get user's team for multi-tenant isolation
  const [teamMembership] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  return {
    id: user.id,
    email: user.email,
    role: user.role as "admin" | "team_member",
    accountStatus: user.accountStatus,
    teamId: teamMembership?.teamId || null,
  };
}

/**
 * Verify that a user ID has admin privileges
 * Throws error if user not found or not an admin
 */
export async function requireAdminById(userId: number): Promise<void> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.role !== "admin") {
    throw new Error("Admin access required");
  }
}

/**
 * Verify that the request is from an authenticated admin user
 * Returns the admin user's ID
 * Throws error with appropriate HTTP status if authentication fails
 */
export async function requireAdmin(req: NextRequest): Promise<number> {
  const authResult = await verifyTokenFromRequestImpl(req);
  
  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  if (authResult.role !== "admin") {
    const error: any = new Error("Admin access required");
    error.statusCode = 403;
    throw error;
  }

  return authResult.userId;
}

/**
 * Verify JWT token from request and check session validity
 * Returns null if token is invalid or session is terminated
 * Exported as both verifyTokenFromRequest and as an alias verifyToken for backwards compatibility
 */
async function verifyTokenFromRequestImpl(req: NextRequest): Promise<{ userId: number; email: string; role: string; sessionId: number } | null> {
  const token = getTokenFromRequest(req);

  if (!token) {
    return null;
  }

  const payload = verifyJWT(token);
  if (!payload) {
    return null;
  }

  const tokenHash = hashToken(token);

  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        eq(sessions.userId, payload.userId),
        isNull(sessions.forceLogoutAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!session) {
    return null;
  }

  return {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    sessionId: session.id,
  };
}

export { verifyTokenFromRequestImpl as verifyToken, verifyTokenFromRequestImpl as verifyTokenFromRequest };

/**
 * Verify authentication and return user with team context
 * Returns userId and teamId for multi-tenant content filtering
 * CRITICAL: Throws error if not authenticated or not in a team
 * This prevents NULL teamId from bypassing team isolation
 * Uses session-aware token verification to prevent false token expiry errors
 */
export async function requireTeamMember(req: NextRequest): Promise<{ userId: number; teamId: number }> {
  // Use session-aware verification instead of direct JWT validation
  const authResult = await verifyTokenFromRequestImpl(req);
  
  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  // Load user to get team context
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, authResult.userId))
    .limit(1);

  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  // Get team membership
  const [teamMembership] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);
  
  // CRITICAL: Reject users without team membership to prevent NULL bypass
  if (!teamMembership?.teamId) {
    const error: any = new Error("Access denied: User must be assigned to a team");
    error.statusCode = 403;
    throw error;
  }
  
  return {
    userId: user.id,
    teamId: teamMembership.teamId, // Guaranteed non-null
  };
}

/**
 * Verify authentication and return user with optional team context
 * Returns userId and teamId (null if user has no team)
 * Useful for routes that should work for users even if not in a team
 * Uses session-aware token verification to prevent false token expiry errors
 */
export async function requireAuth(req: NextRequest): Promise<{ userId: number; teamId: number | null; role: string }> {
  // Use session-aware verification instead of direct JWT validation
  const authResult = await verifyTokenFromRequestImpl(req);
  
  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  // Load user to get team context
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, authResult.userId))
    .limit(1);

  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  // Get team membership if exists
  const [teamMembership] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);
  
  return {
    userId: user.id,
    teamId: teamMembership?.teamId || null,
    role: authResult.role,
  };
}
