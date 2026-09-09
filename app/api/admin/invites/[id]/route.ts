import { NextRequest, NextResponse } from 'next/server';
import { systemDb as db } from '@/lib/db';
import { userInvites } from '@/shared/schema';
import { requireAdmin } from '@/lib/api/auth';
import { eq, and } from 'drizzle-orm';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);

    const { id } = await params;
    const inviteId = parseInt(id);

    if (isNaN(inviteId)) {
      return NextResponse.json({ error: 'Invalid invite ID' }, { status: 400 });
    }

    const result = await db
      .update(userInvites)
      .set({ status: 'revoked' })
      .where(and(eq(userInvites.id, inviteId), eq(userInvites.status, 'pending')))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Pending invite not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error revoking invite:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to revoke invite' },
      { status: error.message?.includes('Admin') ? 403 : 500 }
    );
  }
}
