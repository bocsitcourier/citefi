import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sessions, adminActionLogs } from '@/shared/schema';
import { requireAdmin } from '@/lib/api/auth';
import { eq, and, isNull } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Single session-aware admin check — returns adminUserId directly.
    const adminUserId = await requireAdmin(req);

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const body = await req.json();
    const { reason } = body;

    // Terminate sessions: set both isActive=0 and forceLogoutAt so verifyTokenFromRequestImpl
    // rejects them via both the isActive check AND the forceLogoutAt check.
    const terminatedSessions = await db
      .update(sessions)
      .set({
        isActive: 0,
        forceLogoutAt: new Date(),
        terminatedBy: adminUserId,
        terminationReason: reason || 'Forced logout by admin',
      })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.forceLogoutAt)
        )
      )
      .returning({ id: sessions.id });

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'force_logout',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        sessionCount: terminatedSessions.length,
        reason: reason || 'Forced logout by admin',
        ipAddress: req.headers.get('x-forwarded-for') || 'unknown',
      }),
    });

    return NextResponse.json({
      success: true,
      sessionsTerminated: terminatedSessions.length,
    });
  } catch (error: any) {
    console.error('Error forcing logout:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to force logout' },
      { status: (error?.statusCode ?? 500) }
    );
  }
}
