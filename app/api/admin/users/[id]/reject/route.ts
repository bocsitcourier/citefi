import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, sessions, activityLogs } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { eq } from "drizzle-orm";
import { emailService } from "@/lib/email";

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

    const body = await req.json().catch(() => ({}));
    const sendEmail: boolean = body.sendEmail !== false;

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

    if (user.accountStatus !== "pending_approval") {
      return NextResponse.json(
        { error: "User is not pending approval" },
        { status: 400 }
      );
    }

    await db
      .update(users)
      .set({ accountStatus: "suspended" })
      .where(eq(users.id, userId));

    // Invalidate any existing sessions for the rejected user
    await db
      .update(sessions)
      .set({
        isActive: 0,
        forceLogoutAt: new Date(),
        terminationReason: "registration_rejected",
      })
      .where(eq(sessions.userId, userId));

    await db.insert(activityLogs).values({
      userId: adminUserId,
      action: "user_rejected",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        rejectedEmail: user.email,
        rejectedBy: adminUser?.email || "unknown",
        previousStatus: user.accountStatus,
        emailSent: sendEmail,
      },
      severity: "warning",
    });

    if (sendEmail) {
      emailService.sendAccountRejectedEmail({ to: user.email, fullName: user.fullName }).catch((err) => {
        console.error("Failed to send rejection email:", err);
      });
    }

    return NextResponse.json({
      message: "Registration rejected",
      user: {
        id: user.id,
        email: user.email,
        accountStatus: "suspended",
      },
    });
  } catch (error: unknown) {
    console.error("Reject user error:", error);

    const message = error instanceof Error ? error.message : "";

    if ((error as any).statusCode === 403 || message === "Admin access required") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    if (
      (error as any).statusCode === 401 ||
      message === "Authentication required" ||
      message === "No authentication token provided" ||
      message === "Invalid or expired token"
    ) {
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
