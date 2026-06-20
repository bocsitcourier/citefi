import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, passwordResets, adminActionLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import crypto from "crypto";
import { hashToken } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userIdParam } = await params;
    const userId = parseInt(userIdParam);

    if (isNaN(userId)) {
      return NextResponse.json(
        { error: "Invalid user ID" },
        { status: 400 }
      );
    }

    const adminUserId = await requireAdmin(req);

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

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.insert(passwordResets).values({
      userId,
      tokenHash,
      expiresAt,
      initiatedBy: adminUserId,
      resetType: 'admin_override',
    });

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'password_reset_override',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        expiresAt: expiresAt.toISOString(),
        ipAddress: clientIp,
      }),
    });

    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5000'}/reset-password/${token}`;

    return NextResponse.json({
      success: true,
      resetUrl,
      expiresAt,
      message: "Password reset link generated successfully",
    });
  } catch (error: any) {
    console.error("Admin password reset error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate password reset" },
      { status: error?.statusCode || 500 }
    );
  }
}
