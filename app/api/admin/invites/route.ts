import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userInvites, users } from '@/shared/schema';
import { requireAdminById, verifyToken } from '@/lib/api/auth';
import { eq, and, gt } from 'drizzle-orm';
import crypto from 'crypto';

async function getAdminTeamId(userId: number): Promise<number | null> {
  const [adminUser] = await db
    .select({ defaultTeamId: users.defaultTeamId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return adminUser?.defaultTeamId ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyToken(req);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requireAdminById(auth.userId);

    const invites = await db
      .select({
        id: userInvites.id,
        email: userInvites.email,
        role: userInvites.role,
        status: userInvites.status,
        createdAt: userInvites.createdAt,
        expiresAt: userInvites.expiresAt,
        invitedByName: users.fullName,
        invitedByEmail: users.email,
        message: userInvites.message,
      })
      .from(userInvites)
      .leftJoin(users, eq(userInvites.invitedBy, users.id))
      .orderBy(userInvites.createdAt);

    return NextResponse.json(invites);
  } catch (error: any) {
    console.error('Error fetching invites:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch invites' },
      { status: error.message?.includes('Admin') ? 403 : 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyToken(req);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await requireAdminById(auth.userId);

    const body = await req.json();
    const { email, role = 'team_member', message } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    if (!['admin', 'team_member'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be "admin" or "team_member"' },
        { status: 400 }
      );
    }

    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1);

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    const existingInvite = await db
      .select()
      .from(userInvites)
      .where(
        and(
          eq(userInvites.email, email.toLowerCase()),
          eq(userInvites.status, 'pending'),
          gt(userInvites.expiresAt, new Date())
        )
      )
      .limit(1);

    if (existingInvite.length > 0) {
      return NextResponse.json(
        { error: 'An active invite already exists for this email' },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const adminTeamId = await getAdminTeamId(auth.userId);

    if (!adminTeamId) {
      return NextResponse.json(
        { error: 'Admin account has no team assigned. Please contact a system administrator to assign a team before sending invites.' },
        { status: 400 }
      );
    }

    const insertedInvites = await db
      .insert(userInvites)
      .values({
        email: email.toLowerCase(),
        invitedBy: auth.userId,
        teamId: adminTeamId,
        role,
        tokenHash,
        expiresAt,
        status: 'pending',
        message: message || null,
      })
      .returning();

    const invite = insertedInvites[0];
    if (!invite) {
      return NextResponse.json(
        { error: 'Failed to create invite' },
        { status: 500 }
      );
    }

    const inviteUrl = `${process.env.REPLIT_DEV_DOMAIN || 'http://localhost:5000'}/accept-invite/${token}`;

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📧 USER INVITE SENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Email: ${email}
Role: ${role}
Expires: ${expiresAt.toISOString()}

Invite Link:
${inviteUrl}

${message ? `Message: ${message}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);

    return NextResponse.json({
      success: true,
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        status: invite.status,
        expiresAt: invite.expiresAt,
        inviteUrl,
      },
    });
  } catch (error: any) {
    console.error('Error creating invite:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create invite' },
      { status: error.message?.includes('Admin') ? 403 : 500 }
    );
  }
}
