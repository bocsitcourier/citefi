import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, adminActionLogs } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

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

    const targetUserAny = targetUser as any;
    const newEnforcementStatus = !targetUserAny.twoFactorEnforced;

    await db
      .update(users)
      .set({ twoFactorEnabled: newEnforcementStatus ? 1 : 0 } as any)
      .where(eq(users.id, userId));

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: '2fa_enforcement_toggled',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        targetUserEmail: targetUser.email,
        previousStatus: targetUserAny.twoFactorEnforced,
        newStatus: newEnforcementStatus,
        targetUserRole: targetUser.role,
        ipAddress: clientIp,
      }),
    });

    return NextResponse.json({
      success: true,
      twoFactorEnforced: Boolean(newEnforcementStatus),
      message: `2FA ${newEnforcementStatus ? 'enforced' : 'enforcement removed'} for user`,
    });
  } catch (error: any) {
    console.error("Toggle 2FA enforcement error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to toggle 2FA enforcement" },
      { status: error?.statusCode || 500 }
    );
  }
}
