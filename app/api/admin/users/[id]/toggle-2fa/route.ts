import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import { users, sessions, totpSecrets, adminActionLogs } from "@/shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireRecentAdminMfa } from "@/lib/api/auth";

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

    const adminUserId = await requireRecentAdminMfa(req);
    if (adminUserId === userId) {
      return NextResponse.json(
        { error: "Use Security Settings to change your own authenticator" },
        { status: 400 },
      );
    }

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

    const currentlyEnabled = targetUser.twoFactorEnabled === 1;
    if (!currentlyEnabled) {
      return NextResponse.json(
        { error: "Administrators cannot enable MFA for another user. The user must self-enroll and prove possession of the authenticator." },
        { status: 409 },
      );
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    const now = new Date();
    await db.transaction(async (tx) => {
      const [locked] = await tx.update(users)
        .set({ updatedAt: sql`${users.updatedAt}` })
        .where(and(
          eq(users.id, userId),
          eq(users.accountStatus, "active"),
          eq(users.twoFactorEnabled, 1),
        ))
        .returning({ id: users.id });
      if (!locked) throw new Error("User MFA state changed; refresh and try again");
      await tx.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
      await tx.update(users)
        .set({ twoFactorEnabled: 0, twoFactorMethod: null })
        .where(eq(users.id, userId));
      await tx.update(sessions)
        .set({
          isActive: 0,
          forceLogoutAt: now,
          terminationReason: "Administrator reset two-factor authentication",
        })
        .where(and(eq(sessions.userId, userId), eq(sessions.isActive, 1)));
      await tx.insert(adminActionLogs).values({
        userId: adminUserId,
        action: '2fa_reset',
        targetType: 'user',
        targetId: userId,
        details: JSON.stringify({
          targetUserEmail: targetUser.email,
          previousStatus: true,
          newStatus: false,
          targetUserRole: targetUser.role,
          sessionsRevoked: true,
          ipAddress: clientIp,
        }),
      });
    });

    return NextResponse.json({
      success: true,
      twoFactorEnabled: false,
      message: "Two-factor authentication reset; the user must enroll again",
    });
  } catch (error: any) {
    console.error("Toggle 2FA error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to toggle 2FA" },
      { status: error?.statusCode || 500 }
    );
  }
}
