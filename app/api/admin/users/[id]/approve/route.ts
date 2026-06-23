import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, activityLogs } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { eq } from "drizzle-orm";
import { sendAccountApprovedEmail } from "@/lib/email";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUserId = await requireAdmin(req);
    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    const [adminUser] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Only pending_approval users may be approved — prevents re-activating
    // suspended users or no-op re-approving already-active accounts.
    if (user.accountStatus !== "pending_approval") {
      return NextResponse.json(
        { error: `User is not pending approval (current status: ${user.accountStatus})` },
        { status: 409 }
      );
    }

    await db
      .update(users)
      .set({
        accountStatus: "active",
        emailVerified: 1,
      })
      .where(eq(users.id, userId));

    await db.insert(activityLogs).values({
      userId: adminUserId,
      action: "user_approved",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: { 
        approvedEmail: user.email,
        approvedBy: adminUser?.email || 'unknown',
        previousStatus: user.accountStatus,
      },
      severity: "info",
    });

    // Send approval email (best-effort — don't fail the request if email fails)
    sendAccountApprovedEmail({ to: user.email, fullName: user.fullName }).catch((err) => {
      console.error("Failed to send approval email:", err);
    });

    return NextResponse.json({
      message: "User approved successfully",
      user: {
        id: user.id,
        email: user.email,
        accountStatus: "active",
      },
    });
  } catch (error: unknown) {
    console.error("Approve user error:", error);
    
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
