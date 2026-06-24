import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, activityLogs } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { eq, and } from "drizzle-orm";
import { sendNewSignupAdminNotification } from "@/lib/email";
import { buildApprovalUrls, getBaseUrl } from "@/lib/approval-token";

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

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (targetUser.accountStatus !== "pending_approval") {
      return NextResponse.json(
        { error: `User is not pending approval (current status: ${targetUser.accountStatus})` },
        { status: 409 }
      );
    }

    const activeAdmins = await db
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));

    let approveUrl: string | null = null;
    let rejectUrl: string | null = null;
    try {
      const urls = buildApprovalUrls(targetUser.id, getBaseUrl());
      approveUrl = urls.approveUrl;
      rejectUrl = urls.rejectUrl;
    } catch (tokenErr) {
      console.error("Failed to generate approval token URLs:", tokenErr);
    }

    await Promise.all(
      activeAdmins.map((admin) =>
        sendNewSignupAdminNotification({
          adminEmail: admin.email,
          newUserEmail: targetUser.email,
          newUserName: targetUser.fullName,
          teamName: null,
          approveUrl,
          rejectUrl,
        }).catch((err) =>
          console.error(`Failed to resend approval email to admin ${admin.email}:`, err)
        )
      )
    );

    await db.insert(activityLogs).values({
      userId: adminUserId,
      action: "approval_email_resent",
      resource: "users",
      resourceId: userId,
      ipAddress: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      details: {
        targetEmail: targetUser.email,
        triggeredBy: adminUser?.email || "unknown",
        adminCount: activeAdmins.length,
      },
      severity: "info",
    });

    return NextResponse.json({
      message: "Approval email resent successfully",
      adminCount: activeAdmins.length,
    });
  } catch (error: unknown) {
    console.error("Resend approval email error:", error);

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
