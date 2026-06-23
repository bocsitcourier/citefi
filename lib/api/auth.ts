import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, teamMembers, teams } from "@/shared/schema";
import { verifyToken as verifyJWT, hashToken } from "@/lib/auth";
import { eq, and, isNull, gt, ne } from "drizzle-orm";

/** Five-minute throttle for lastActivityAt writes — one DB write per session per 5 min. */
const ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;

/**
 * In-memory set of session IDs whose lastActivityAt write recently failed.
 * Suppresses repeated log noise: only one error is emitted per session per throttle window.
 */
const recentActivityFailures = new Set<number>();

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
    .select({ role: users.role, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (user.accountStatus !== "active") {
    const error: any = new Error("Account is not active");
    error.statusCode = 401;
    throw error;
  }

  if (user.role !== "admin") {
    const error: any = new Error("Admin access required");
    error.statusCode = 403;
    throw error;
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

  // Re-fetch role and accountStatus from DB — JWT role may be stale if the user
  // was demoted or suspended after their last login.
  const [user] = await db
    .select({ role: users.role, accountStatus: users.accountStatus })
    .from(users)
    .where(eq(users.id, authResult.userId))
    .limit(1);

  if (!user || user.accountStatus !== "active") {
    const error: any = new Error("Account is not active");
    error.statusCode = 401;
    throw error;
  }

  if (user.role !== "admin") {
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
async function verifyTokenFromRequestImpl(req: NextRequest): Promise<{ userId: number; email: string; role: string; sessionId: number; teamContextId: number | null } | null> {
  // Build ordered candidate list: Bearer header first, then HttpOnly cookie.
  // If Bearer holds a stale/revoked token (e.g. localStorage legacy token), we
  // transparently fall through to the cookie so users aren't force-logged-out.
  const candidates: string[] = [];

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const t = authHeader.slice(7).trim();
    if (t && t !== "null" && t !== "undefined") candidates.push(t);
  }

  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === AUTH_COOKIE_NAME) {
        const val = decodeURIComponent(part.slice(idx + 1).trim());
        if (val && !candidates.includes(val)) candidates.push(val);
        break;
      }
    }
  }

  for (const token of candidates) {
    const payload = verifyJWT(token);
    if (!payload) continue; // Invalid/expired JWT — try next candidate

    const tokenHash = hashToken(token);

    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.userId, payload.userId),
          eq(sessions.isActive, 1),
          isNull(sessions.forceLogoutAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) continue; // No active session row — try next candidate (cookie fallback)

    // Throttled lastActivityAt refresh — one write per session per 5 min.
    const now = new Date();
    const lastActivity = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
    if (!lastActivity || now.getTime() - lastActivity.getTime() > ACTIVITY_THROTTLE_MS) {
      const sid = session.id;
      db.update(sessions)
        .set({ lastActivityAt: now })
        .where(eq(sessions.id, sid))
        .catch((e) => {
          // Log once per session per throttle window to avoid flooding logs during DB degradation.
          if (!recentActivityFailures.has(sid)) {
            recentActivityFailures.add(sid);
            console.error("[auth] lastActivityAt update failed:", e);
            setTimeout(() => recentActivityFailures.delete(sid), ACTIVITY_THROTTLE_MS);
          }
        });
    }

    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      sessionId: session.id,
      teamContextId: session.teamContextId ?? null,
    };
  }

  return null;
}

export { verifyTokenFromRequestImpl as verifyToken, verifyTokenFromRequestImpl as verifyTokenFromRequest };

/**
 * Verify authentication and return user with team context
 * Returns userId and teamId for multi-tenant content filtering
 * CRITICAL: Throws error if not authenticated or not in a team
 * This prevents NULL teamId from bypassing team isolation
 * Uses session-aware token verification to prevent false token expiry errors
 */
export async function requireTeamMember(req: NextRequest): Promise<{ userId: number; teamId: number; role: string }> {
  const authResult = await verifyTokenFromRequestImpl(req);
  
  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

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

  if (user.accountStatus !== "active") {
    const error: any = new Error("Account is not active");
    error.statusCode = 401;
    throw error;
  }

  // If the session has an active team context, validate it strictly —
  // NEVER fall through to a different team if the context is unauthorized.
  if (authResult.teamContextId) {
    // Check 1: direct membership
    const [directMembership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, authResult.teamContextId)))
      .limit(1);

    if (directMembership) {
      return { userId: user.id, teamId: authResult.teamContextId, role: directMembership.role };
    }

    // Check 2: agency-admin inheritance — user is admin of the client team's parent agency.
    // The inner join on teams ensures the parent agency team is not soft-deleted.
    const [targetTeam] = await db
      .select({ parentTeamId: teams.parentTeamId })
      .from(teams)
      .where(and(eq(teams.id, authResult.teamContextId), isNull(teams.deletedAt)))
      .limit(1);

    if (targetTeam?.parentTeamId) {
      const [agencyMembership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), isNull(teams.deletedAt)))
        .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, targetTeam.parentTeamId)))
        .limit(1);

      if (agencyMembership?.role === "admin") {
        return { userId: user.id, teamId: authResult.teamContextId, role: "admin" };
      }
    }

    // teamContextId is set but the user no longer has access — hard-fail with 403.
    // Do NOT fall through to a different team; the caller explicitly targeted this context.
    const error: any = new Error("Access denied: team context is no longer authorized");
    error.statusCode = 403;
    throw error;
  }

  // No explicit context — resolve from first direct team membership
  const [teamMembership] = await db
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.userId, user.id))
    .limit(1);
  
  if (!teamMembership?.teamId) {
    const error: any = new Error("Access denied: User must be assigned to a team");
    error.statusCode = 403;
    throw error;
  }
  
  return {
    userId: user.id,
    teamId: teamMembership.teamId,
    role: teamMembership.role,
  };
}

/**
 * Require the authenticated user to be a team admin (role = 'admin' in team_members).
 * Used for high-privilege billing actions: checkout, portal, subscription management.
 */
export async function requireTeamAdmin(req: NextRequest): Promise<{ userId: number; teamId: number }> {
  const authResult = await verifyTokenFromRequestImpl(req);

  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  const [user] = await db.select().from(users).where(eq(users.id, authResult.userId)).limit(1);
  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if (user.accountStatus !== "active") {
    const error: any = new Error("Account is not active");
    error.statusCode = 401;
    throw error;
  }

  // If the session has an active team context, validate strictly — hard-fail if unauthorized.
  if (authResult.teamContextId) {
    // Global admins bypass team-role check for any context
    if (user.role === "admin") {
      return { userId: user.id, teamId: authResult.teamContextId };
    }

    // Direct membership with admin role
    const [directMembership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, authResult.teamContextId)))
      .limit(1);

    if (directMembership?.role === "admin") {
      return { userId: user.id, teamId: authResult.teamContextId };
    }

    // Agency-admin inheritance: user is admin of the parent agency team.
    // The inner join on teams ensures the parent agency team is not soft-deleted.
    const [targetTeam] = await db
      .select({ parentTeamId: teams.parentTeamId })
      .from(teams)
      .where(and(eq(teams.id, authResult.teamContextId), isNull(teams.deletedAt)))
      .limit(1);

    if (targetTeam?.parentTeamId) {
      const [agencyMembership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .innerJoin(teams, and(eq(teams.id, teamMembers.teamId), isNull(teams.deletedAt)))
        .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, targetTeam.parentTeamId)))
        .limit(1);

      if (agencyMembership?.role === "admin") {
        return { userId: user.id, teamId: authResult.teamContextId };
      }
    }

    // teamContextId set but not admin — hard-fail, do not fall through
    const ctxError: any = new Error("Access denied: insufficient privileges for requested team context");
    ctxError.statusCode = 403;
    throw ctxError;
  }

  // Global admins bypass team-role check
  if (user.role === "admin") {
    const [teamMembership] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
      .limit(1);
    if (!teamMembership?.teamId) {
      const error: any = new Error("Access denied: No team membership");
      error.statusCode = 403;
      throw error;
    }
    return { userId: user.id, teamId: teamMembership.teamId };
  }

  // For regular team members, require role='admin' in team_members
  const [teamMembership] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, user.id)))
    .limit(1);

  if (!teamMembership?.teamId) {
    const error: any = new Error("Access denied: No team membership");
    error.statusCode = 403;
    throw error;
  }

  if (teamMembership.role !== "admin") {
    const error: any = new Error("Access denied: Only team admins can manage this resource");
    error.statusCode = 403;
    throw error;
  }

  return { userId: user.id, teamId: teamMembership.teamId };
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

  if (user.accountStatus !== "active") {
    const error: any = new Error("Account is not active");
    error.statusCode = 401;
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

/**
 * Guard: verifies a content resource belongs to the authenticated team.
 *
 * Throws 404 (not 403) so that IDOR attempts cannot probe resource existence.
 * Use on every content read/write route after `requireTeamMember()`.
 *
 * @example
 *   const { teamId } = await requireTeamMember(req);
 *   requireTeamResource(article.teamId, teamId);
 */
export function requireTeamResource(resourceTeamId: number, authTeamId: number): void {
  if (resourceTeamId !== authTeamId) {
    const error: any = new Error("Resource not found");
    error.statusCode = 404;
    throw error;
  }
}

/**
 * requireClientReviewer — allows admin | member | client_viewer roles.
 * Use on read-only review routes that client viewers should access.
 * Returns userId, teamId, and the member's role.
 *
 * Mirrors requireTeamMember's teamContextId logic so multi-team users
 * always resolve to the session's active team rather than a random row.
 */
export async function requireClientReviewer(req: NextRequest): Promise<{ userId: number; teamId: number; role: string }> {
  const authResult = await verifyTokenFromRequestImpl(req);
  if (!authResult) {
    const error: any = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  const [user] = await db.select().from(users).where(eq(users.id, authResult.userId)).limit(1);
  if (!user) { const e: any = new Error("User not found"); e.statusCode = 404; throw e; }
  if (user.accountStatus !== "active") { const e: any = new Error("Account is not active"); e.statusCode = 401; throw e; }

  const ALLOWED = ["admin", "member", "client_viewer"];

  if (authResult.teamContextId) {
    // Validate membership against the session's explicit team context
    const [directMembership] = await db
      .select({ role: teamMembers.role })
      .from(teamMembers)
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, authResult.teamContextId)))
      .limit(1);

    if (directMembership && ALLOWED.includes(directMembership.role)) {
      return { userId: user.id, teamId: authResult.teamContextId, role: directMembership.role };
    }

    // Agency-admin inheritance: user is admin of the client team's parent
    const [targetTeam] = await db
      .select({ parentTeamId: teams.parentTeamId })
      .from(teams)
      .where(and(eq(teams.id, authResult.teamContextId), isNull(teams.deletedAt)))
      .limit(1);

    if (targetTeam?.parentTeamId) {
      const [agencyMembership] = await db
        .select({ role: teamMembers.role })
        .from(teamMembers)
        .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, targetTeam.parentTeamId)))
        .limit(1);

      if (agencyMembership?.role === "admin") {
        return { userId: user.id, teamId: authResult.teamContextId, role: "admin" };
      }
    }

    // teamContextId set but no valid membership — hard-fail, never fall through
    const e: any = new Error("Access denied: team context is no longer authorized");
    e.statusCode = 403;
    throw e;
  }

  // No explicit context — fall back to first membership, but only if role is allowed
  const [membership] = await db.select().from(teamMembers).where(eq(teamMembers.userId, user.id)).limit(1);
  if (!membership) { const e: any = new Error("Not a team member"); e.statusCode = 403; throw e; }

  if (!ALLOWED.includes(membership.role)) {
    const e: any = new Error("Access denied");
    e.statusCode = 403;
    throw e;
  }

  return { userId: user.id, teamId: membership.teamId, role: membership.role };
}

/**
 * requireContentEditor — allows admin | member roles only.
 * Blocks client_viewer. Use on write routes (create, update, delete content).
 */
export async function requireContentEditor(req: NextRequest): Promise<{ userId: number; teamId: number; role: string }> {
  const { userId, teamId, role } = await requireClientReviewer(req);
  if (role === "client_viewer") {
    const e: any = new Error("Client reviewers have read-only access");
    e.statusCode = 403;
    throw e;
  }
  return { userId, teamId, role };
}
