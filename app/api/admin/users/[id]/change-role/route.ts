import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, adminActionLogs } from '@/shared/schema';
import { requireAdminById, verifyToken } from '@/lib/api/auth';
import { eq, and, ne, count, sql } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await verifyToken(req);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requireAdminById(auth.userId);

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

    if (targetUser.role === 'admin' && newRole === 'team_member') {
      if (targetUser.accountStatus !== 'active') {
        return NextResponse.json(
          { error: 'Cannot change role of non-active user' },
          { status: 400 }
        );
      }

      const [result] = await db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.role, 'admin'),
            eq(users.accountStatus, 'active'),
            ne(users.id, userId)
          )
        );

      const remainingAdminCount = result?.count || 0;

      if (remainingAdminCount < 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last active admin. At least one active admin must remain.' },
          { status: 400 }
        );
      }
    }

    await db
      .update(users)
      .set({ role: newRole })
      .where(eq(users.id, userId));

    await db.insert(adminActionLogs).values({
      userId: auth.userId,
      action: 'change_role',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        oldRole: targetUser.role,
        newRole,
        targetUserEmail: targetUser.email,
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      }),
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
      { status: error.message?.includes('Admin') ? 403 : 500 }
    );
  }
}
