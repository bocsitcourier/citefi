import { NextRequest, NextResponse } from 'next/server';
import { systemDb as db } from '@/lib/db';
import { sessions, users } from '@/shared/schema';
import { requireAdmin } from '@/lib/api/auth';
import { eq, and, isNull, gt, desc } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const activeSessions = await db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        forceLogoutAt: sessions.forceLogoutAt,
        terminationReason: sessions.terminationReason,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.isActive, 1),
          isNull(sessions.forceLogoutAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      .orderBy(desc(sessions.createdAt));

    return NextResponse.json({
      sessions: activeSessions,
      count: activeSessions.length,
    });
  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch sessions' },
      { status: error.message?.includes('Admin') ? 403 : 500 }
    );
  }
}
