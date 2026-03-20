import { Request, Response, NextFunction } from "express";
import { verifyToken, JWTPayload } from "../../lib/auth";
import { db } from "../../lib/db";
import { users, sessions, activityLogs, teamMembers } from "../../shared/schema";
import { eq, and } from "drizzle-orm";

// Extend Express Request to include user info with team context
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload & {
        id: number;
        email: string;
        role: string;
        teamId: number | null; // Multi-tenant team isolation
      };
    }
  }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized - No token provided" });
    }

    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (!payload) {
      return res.status(401).json({ error: "Unauthorized - Invalid or expired token" });
    }

    // CRITICAL: Validate session is still active (enables logout/forced logout)
    const tokenHash = require("../../lib/auth").hashToken(token);
    const [session] = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          eq(sessions.isActive, 1)
        )
      )
      .limit(1);

    if (!session) {
      return res.status(401).json({ error: "Unauthorized - Session has been terminated" });
    }

    // Check if session expired
    if (new Date() > new Date(session.expiresAt)) {
      await db
        .update(sessions)
        .set({ isActive: 0 })
        .where(eq(sessions.id, session.id));
      return res.status(401).json({ error: "Unauthorized - Session expired" });
    }

    // Verify user still exists and is active
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!user) {
      return res.status(401).json({ error: "Unauthorized - User not found" });
    }

    if (user.accountStatus !== "active") {
      return res.status(403).json({ error: "Forbidden - Account is not active" });
    }

    // CRITICAL: Get user's team for multi-tenant isolation
    // Users can be in multiple teams, but we use the first one for now
    // TODO: Add team switching capability for users in multiple teams
    const [teamMembership] = await db
      .select()
      .from(teamMembers)
      .where(eq(teamMembers.userId, user.id))
      .limit(1);

    // Update last activity timestamp
    await db
      .update(sessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(sessions.id, session.id));

    // Attach user to request with team context
    req.user = {
      ...payload,
      id: user.id,
      email: user.email,
      role: user.role,
      teamId: teamMembership?.teamId || null, // null for users not yet in a team
    };

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({ error: "Unauthorized - Authentication failed" });
  }
}

// ============================================================================
// ROLE-BASED ACCESS CONTROL
// ============================================================================

export function requireRole(requiredRole: string | string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    
    if (!roles.includes(req.user.role)) {
      await logActivity({
        userId: req.user.id,
        action: "access_denied",
        resource: "role_check",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: { requiredRole, userRole: req.user.role },
        severity: "warning",
      });

      return res.status(403).json({ error: "Forbidden - Insufficient permissions" });
    }

    return next();
  };
}

export const requireAdmin = requireRole("admin");
export const requireTeamMember = requireRole(["admin", "team_member"]);

// ============================================================================
// ACTIVITY LOGGING HELPER
// ============================================================================

export interface ActivityLogParams {
  userId?: number;
  teamId?: number;
  action: string;
  resource?: string;
  resourceId?: number;
  targetType?: string;
  targetPublicId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: any;
  severity?: "info" | "warning" | "error" | "critical";
}

export async function logActivity(params: ActivityLogParams) {
  try {
    await db.insert(activityLogs).values({
      userId: params.userId || null,
      teamId: params.teamId || null,
      action: params.action,
      resource: params.resource || null,
      resourceId: params.resourceId || null,
      targetType: params.targetType || null,
      targetPublicId: params.targetPublicId || null,
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      details: params.details || null,
      severity: params.severity || "info",
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}

// ============================================================================
// SESSION VALIDATION
// ============================================================================

export async function validateSession(userId: number, tokenHash: string): Promise<boolean> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.tokenHash, tokenHash),
        eq(sessions.isActive, 1)
      )
    )
    .limit(1);

  if (!session) {
    return false;
  }

  // Check if session expired
  if (new Date() > new Date(session.expiresAt)) {
    await db
      .update(sessions)
      .set({ isActive: 0 })
      .where(eq(sessions.id, session.id));
    return false;
  }

  // Update last activity
  await db
    .update(sessions)
    .set({ lastActivityAt: new Date() })
    .where(eq(sessions.id, session.id));

  return true;
}
