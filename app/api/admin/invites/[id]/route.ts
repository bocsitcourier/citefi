import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userInvites } from '@/shared/schema';
import { requireAdminById, verifyToken } from '@/lib/api/auth';
import { eq } from 'drizzle-orm';

export async function DELETE(
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
    const inviteId = parseInt(id);

    if (isNaN(inviteId)) {
      return NextResponse.json({ error: 'Invalid invite ID' }, { status: 400 });
    }

    const result = await db
      .update(userInvites)
      .set({ status: 'revoked' })
      .where(eq(userInvites.id, inviteId))
      .returning();

    if (result.length === 0) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
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
