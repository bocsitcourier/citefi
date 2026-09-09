import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import { users, sessions, activityLogs } from "@/shared/schema";
import { requireRecentAdminMfa } from "@/lib/api/auth";
import { eq, isNull } from "drizzle-orm";
import { countActivePlatformAdmins, lockPlatformAdminState } from "@/lib/admin-invariant";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUserId = await requireRecentAdminMfa(req);
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    if (userId === adminUserId) {
      return NextResponse.json(
        { error: "Cannot suspend your own account" },
        { status: 400 }
      );
    }

    const [adminUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    const outcome = await db.transaction(async (tx) => {
      await lockPlatformAdminState(tx);
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        const error: any = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }
      if (user.accountStatus !== "active") {
        const error: any = new Error(
          `Cannot suspend an account with status ${user.accountStatus}`,
        );
        error.statusCode = 409;
        throw error;
      }
      if (user.role === "admin" && await countActivePlatformAdmins(tx) <= 1) {
        const error: any = new Error(
          "Cannot suspend the last active admin. At least one active admin must remain.",
        );
        error.statusCode = 409;
        throw error;
      }

      await tx.update(users)
        .set({ accountStatus: "suspended" })
        .where(eq(users.id, userId));
      const terminatedSessions = await tx
        .update(sessions)
        .set({
          isActive: 0,
          forceLogoutAt: new Date(),
          terminationReason: "account_suspended",
        })
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      await tx.insert(activityLogs).values({
        userId: adminUserId,
        action: "user_suspended",
        resource: "users",
        resourceId: userId,
        ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        userAgent: req.headers.get("user-agent") || null,
        details: {
          suspendedEmail: user.email,
          suspendedBy: adminUser?.email || "unknown",
          previousStatus: user.accountStatus,
          sessionsTerminated: terminatedSessions.length,
        },
        severity: "warning",
      });
      return { user, terminatedSessions: terminatedSessions.length };
    });

    return NextResponse.json({
      message: "User suspended successfully",
      user: {
        id: outcome.user.id,
        email: outcome.user.email,
        accountStatus: "suspended",
      },
      sessionsTerminated: outcome.terminatedSessions,
    });
  } catch (error: unknown) {
    console.error("Suspend user error:", error);
    
    const message = error instanceof Error ? error.message : "";
    
    if ((error as any).statusCode === 403 || message === "Admin access required") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    if ((error as any).statusCode === 401 ||
        message === "Authentication required" ||
        message === "No authentication token provided" || 
        message === "Invalid or expired token") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: (error as any)?.statusCode || 500 }
    );
  }
}
