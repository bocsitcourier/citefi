import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teams } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { desc, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    // Verify admin access
    await requireAdmin(req);

    // Fetch all users with their default team name (join via defaultTeamId to avoid duplicates).
    // Also surface whether a one-click approval email-link was consumed for this user so the
    // admin panel can show a "Link used" badge next to any still-pending registrations.
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        accountStatus: users.accountStatus,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        teamName: teams.name,
        approvalLinkUsedAt: sql<string | null>`(
          SELECT uat.used_at
          FROM used_approval_tokens uat
          WHERE uat.user_id = ${users.id}
          ORDER BY uat.used_at DESC
          LIMIT 1
        )`.as("approvalLinkUsedAt"),
        approvalLinkAction: sql<string | null>`(
          SELECT uat.action
          FROM used_approval_tokens uat
          WHERE uat.user_id = ${users.id}
          ORDER BY uat.used_at DESC
          LIMIT 1
        )`.as("approvalLinkAction"),
      })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.defaultTeamId))
      .orderBy(desc(users.createdAt));

    return NextResponse.json(allUsers);
  } catch (error: any) {
    console.error("Get users error:", error);
    
    if (error.statusCode === 403 || error.message === "Admin access required") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    if (error.statusCode === 401 || 
        error.message === "Authentication required" ||
        error.message === "No authentication token provided" || 
        error.message === "Invalid or expired token" ||
        error.message === "Account is not active") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: error?.statusCode || 500 }
    );
  }
}
