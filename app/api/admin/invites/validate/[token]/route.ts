import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { userInvites } from '@/shared/schema';
import { eq, and, gt } from 'drizzle-orm';
import crypto from 'crypto';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`invite-validate:${ip}`, 20, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const [invite] = await db
      .select()
      .from(userInvites)
      .where(
        and(
          eq(userInvites.tokenHash, tokenHash),
          eq(userInvites.status, 'pending'),
          gt(userInvites.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!invite) {
      return NextResponse.json(
        { error: 'Invalid or expired invite link' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      email: invite.email,
      role: invite.role,
      message: invite.message,
    });
  } catch (error: any) {
    console.error('Error validating invite:', error);
    return NextResponse.json(
      { error: 'Failed to validate invite' },
      { status: 500 }
    );
  }
}
