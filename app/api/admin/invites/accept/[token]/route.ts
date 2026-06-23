import { NextRequest, NextResponse } from 'next/server';
import { db, getTxDb } from '@/lib/db';
import { userInvites, users, teamMembers, teams } from '@/shared/schema';
import { eq, and, gt, count } from 'drizzle-orm';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { BILLING_PLANS } from '@/lib/billing/plans';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`invite-accept:${ip}`, 10, 60 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const { token } = await params;
    const body = await req.json();
    const { fullName, password } = body;

    if (!fullName || fullName.length < 2) {
      return NextResponse.json(
        { error: 'Full name must be at least 2 characters' },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
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

    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, invite.email))
      .limit(1);

    if (existingUser.length > 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 400 }
      );
    }

    // ── Seat limit enforcement (second gate at accept time) ────────────────
    // Rechecks the limit to handle plan downgrades that occurred after the
    // invite was created, or edge cases where multiple invites were in-flight.
    const teamId = invite.teamId ?? null;
    if (teamId !== null) {
      const [teamRow] = await db
        .select({ billingPlan: teams.billingPlan })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      const planKey = (teamRow?.billingPlan ?? 'free') as keyof typeof BILLING_PLANS;
      const plan = BILLING_PLANS[planKey] ?? BILLING_PLANS.free;
      const maxSeats = plan.maxSeats;

      if (maxSeats !== null) {
        const [memberCountRow] = await db
          .select({ n: count() })
          .from(teamMembers)
          .where(eq(teamMembers.teamId, teamId));

        const currentMembers = memberCountRow?.n ?? 0;
        if (currentMembers >= maxSeats) {
          return NextResponse.json({
            error: `This team has reached its seat limit (${maxSeats} seat${maxSeats !== 1 ? 's' : ''} on the ${plan.name} plan). Please contact the team admin.`,
          }, { status: 402 });
        }
      }
    }
    // ── End seat limit enforcement ──────────────────────────────────────────

    const hashedPassword = await bcrypt.hash(password, 12);

    const txDb = getTxDb();
    let newUser: typeof users.$inferSelect;

    await txDb.transaction(async (tx) => {
      const insertedUsers = await tx
        .insert(users)
        .values({
          email: invite.email,
          fullName,
          passwordHash: hashedPassword,
          role: invite.role,
          accountStatus: 'active',
          emailVerified: 1,
          ...(teamId ? { defaultTeamId: teamId } : {}),
        })
        .returning();

      newUser = insertedUsers[0];
      if (!newUser) throw new Error('Failed to create user account');

      if (teamId) {
        await tx
          .insert(teamMembers)
          .values({
            teamId,
            userId: newUser.id,
            role: invite.role === 'admin' ? 'admin' : 'member',
          })
          .onConflictDoNothing();
      }

      await tx
        .update(userInvites)
        .set({
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedBy: newUser.id,
        })
        .where(eq(userInvites.id, invite.id));
    });

    return NextResponse.json({
      success: true,
      user: {
        id: newUser!.id,
        email: newUser!.email,
        fullName: newUser!.fullName,
        role: newUser!.role,
      },
    });
  } catch (error: any) {
    console.error('Error accepting invite:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to accept invite' },
      { status: 500 }
    );
  }
}
