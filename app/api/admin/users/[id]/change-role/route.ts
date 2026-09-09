import { NextRequest, NextResponse } from 'next/server';
import { systemDb as db } from '@/lib/db';
import { users, adminActionLogs } from '@/shared/schema';
import { requireRecentAdminMfa } from '@/lib/api/auth';
import { eq } from 'drizzle-orm';
import { countActivePlatformAdmins, lockPlatformAdminState } from '@/lib/admin-invariant';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminUserId = await requireRecentAdminMfa(req);

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const body = await req.json();
    const { newRole } = body;

    if (!newRole || !['admin', 'team_member'].includes(newRole)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be "admin" or "team_member"' },
        { status: 400 }
      );
    }

    // Prevent an admin from modifying their own role
    if (userId === adminUserId) {
      return NextResponse.json(
        { error: 'Cannot change your own role. Ask another admin to do this.' },
        { status: 400 }
      );
    }

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (targetUser.role === newRole) {
      return NextResponse.json(
        { error: `User is already a ${newRole}` },
        { status: 400 }
      );
    }

    await db.transaction(async (tx) => {
      await lockPlatformAdminState(tx);
      const [currentTarget] = await tx
        .select({
          role: users.role,
          accountStatus: users.accountStatus,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!currentTarget) {
        const error: any = new Error("User not found");
        error.statusCode = 404;
        throw error;
      }
      if (currentTarget.role === newRole) {
        const error: any = new Error(`User is already a ${newRole}`);
        error.statusCode = 409;
        throw error;
      }
      if (currentTarget.role === "admin" && newRole === "team_member") {
        if (currentTarget.accountStatus !== "active") {
          const error: any = new Error("Cannot change role of non-active user");
          error.statusCode = 409;
          throw error;
        }
        if (await countActivePlatformAdmins(tx) <= 1) {
          const error: any = new Error(
            "Cannot demote the last active admin. At least one active admin must remain.",
          );
          error.statusCode = 409;
          throw error;
        }
      }

      await tx
        .update(users)
        .set({
          role: newRole,
          mfaEnrollmentDeadline: newRole === "admin"
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : null,
        })
        .where(eq(users.id, userId));
      await tx.insert(adminActionLogs).values({
        userId: adminUserId,
        action: 'change_role',
        targetType: 'user',
        targetId: userId,
        details: JSON.stringify({
          oldRole: currentTarget.role,
          newRole,
          targetUserEmail: currentTarget.email,
          ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
        }),
      });
    });

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        email: targetUser.email,
        role: newRole,
      },
    });
  } catch (error: any) {
    console.error('Error changing user role:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to change user role' },
      { status: error?.statusCode || (error.message?.includes('Admin') ? 403 : 500) }
    );
  }
}
