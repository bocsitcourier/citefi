/**
 * POST /api/admin/users/[id]/revoke-approval-token
 *
 * Explicitly revoke all outstanding approval links for a pending user.
 * After revocation, any existing email links for that user return 400 (revoked).
 * New links issued via POST /api/admin/users/[id]/resend-approval are NOT
 * blocked (their token exp falls outside the revocation window).
 *
 * Requires: admin authentication.
 * Idempotent: calling it again simply upserts a fresh revocation window.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, activityLogs, revokedApprovalTokens } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { eq } from "drizzle-orm";

/** 7-day window, matching APPROVAL_TOKEN_TTL_MS in lib/approval-token.ts */
const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUserId = await requireAdmin(req);
    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Verify the target user exists and is pending_approval
    const [targetUser] = await db
      .select({ id: users.id, email: users.email, accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (targetUser.accountStatus !== "pending_approval") {
      return NextResponse.json(
        {
          error: `User is not pending approval (current status: ${targetUser.accountStatus}). Only pending_approval accounts have approval links.`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + APPROVAL_TOKEN_TTL_MS);

    // Insert a revocation record. If one already exists for this user it will be
    // replaced by the new (fresher) window via conflict handling.
    await db
      .insert(revokedApprovalTokens)
      .values({
        userId,
        revokedAt: now,
        revokedBy: adminUserId,
        expiresAt,
      });

    await db.insert(activityLogs).values({
      userId: adminUserId,
      action: "approval_token_revoked",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        targetEmail: targetUser.email,
        revokedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      severity: "warning",
    });

    return NextResponse.json({
      message: "Approval links revoked successfully",
      userId,
      revokedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error: unknown) {
    console.error("Revoke approval token error:", error);

    const message = error instanceof Error ? error.message : "";

    if ((error as any).statusCode === 403 || message === "Admin access required") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    if (
      (error as any).statusCode === 401 ||
      message === "Authentication required" ||
      message === "No authentication token provided" ||
      message === "Invalid or expired token"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: (error as any)?.statusCode || 500 }
    );
  }
}
