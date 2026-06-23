import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResets, adminActionLogs } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { deliverEmail } from "@/lib/email";
import crypto from "crypto";
import { hashToken } from "@/lib/auth";

function deriveAppOrigin(req: NextRequest): string {
  const origin = req.headers.get("origin");
  if (origin) return origin;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (forwardedHost) return `${proto}://${forwardedHost}`;

  return (process.env.NEXTAUTH_URL ?? "http://localhost:5000").replace(/\/$/, "");
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userIdParam } = await params;
    const userId = parseInt(userIdParam);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const adminUserId = await requireAdmin(req);

    const [targetUser] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db
      .update(passwordResets)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(passwordResets.userId, userId),
          eq(passwordResets.status, "pending")
        )
      );

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(passwordResets).values({
      userId,
      tokenHash,
      expiresAt,
      initiatedBy: adminUserId,
      resetType: "admin_override",
    });

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("x-real-ip") ||
      "unknown";

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: "password_reset_override",
      targetType: "user",
      targetId: userId,
      details: JSON.stringify({
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        expiresAt: expiresAt.toISOString(),
        ipAddress: clientIp,
      }),
    });

    const appOrigin = deriveAppOrigin(req);
    const resetUrl = `${appOrigin}/reset-password/${token}`;

    await deliverEmail({
      to: targetUser.email,
      subject: "Your Citefi password reset link",
      text: `An administrator has generated a password reset link for your account.\n\nClick the link below to set a new password:\n${resetUrl}\n\nThis link expires in 24 hours.`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
<h2 style="margin-bottom:8px">Password Reset</h2>
<p style="color:#666">An administrator has generated a password reset link for your Citefi account.</p>
<p style="margin:20px 0">
  <a href="${resetUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Reset My Password</a>
</p>
<p style="color:#999;font-size:0.85em">Or copy this link: ${resetUrl}</p>
<p style="color:#999;font-size:0.8em">This link expires in <strong>24 hours</strong>.</p>
</div>`,
    });

    return NextResponse.json({
      success: true,
      resetUrl,
      expiresAt,
      message: "Password reset link generated and emailed successfully",
    });
  } catch (error: any) {
    console.error("Admin password reset error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate password reset" },
      { status: error?.statusCode || 500 }
    );
  }
}
