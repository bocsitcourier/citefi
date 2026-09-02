import { NextRequest, NextResponse } from 'next/server';
import { getTxDb } from '@/lib/db';
import { userInvites, users, teamMembers, teams } from '@/shared/schema';
import { eq, and, gt, count, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { hashPassword, validatePassword } from '@/lib/auth';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { BILLING_PLANS } from '@/lib/billing/plans';
import { enterSystemContext } from '@/lib/tenant-context';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  enterSystemContext("public team invitation acceptance");
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

    const passwordValidation = validatePassword(password || "");
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { error: passwordValidation.errors[0], errors: passwordValidation.errors },
        { status: 400 }
      );
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const hashedPassword = await hashPassword(password);

    const txDb = getTxDb();
    let newUser: typeof users.$inferSelect;

    await txDb.transaction(async (tx) => {
      const inviteResult = await tx.execute(sql`
        SELECT * FROM user_invites
        WHERE token_hash = ${tokenHash} AND status = 'pending' AND expires_at > now()
        FOR UPDATE
      `);
      const invite = (inviteResult.rows?.[0] ?? null) as any;
      if (!invite) {
        const error: any = new Error('Invalid or expired invite link');
        error.statusCode = 404;
        throw error;
      }
      const teamId = invite.team_id as number | null;
      if (teamId !== null) {
        const teamResult = await tx.execute(sql`
          SELECT id, billing_plan, client_status, deleted_at FROM teams
          WHERE id = ${teamId} FOR UPDATE
        `);
        const team = teamResult.rows?.[0] as any;
        if (!team || team.deleted_at || team.client_status !== 'active') {
          const error: any = new Error('Invited team is no longer active');
          error.statusCode = 409;
          throw error;
        }
        const plan = BILLING_PLANS[(team.billing_plan ?? 'free') as keyof typeof BILLING_PLANS] ?? BILLING_PLANS.free;
        if (plan.maxSeats !== null) {
          const [memberCount] = await tx.select({ n: count() }).from(teamMembers)
            .where(eq(teamMembers.teamId, teamId));
          if ((memberCount?.n ?? 0) >= plan.maxSeats) {
            const error: any = new Error(`This team has reached its seat limit (${plan.maxSeats} seats on the ${plan.name} plan).`);
            error.statusCode = 402;
            throw error;
          }
        }
      }
      const [existing] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.email, invite.email)).limit(1);
      if (existing) {
        const error: any = new Error('An account with this email already exists');
        error.statusCode = 409;
        throw error;
      }
      const insertedUsers = await tx
        .insert(users)
        .values({
          email: invite.email,
          fullName,
          passwordHash: hashedPassword,
          // SECURITY: Always assign team_member at the platform level.
          // Team-level admin privilege lives only in teamMembers.role — never
          // elevate a team invite into a global platform admin.
          role: 'team_member',
          accountStatus: 'active',
          emailVerified: 1,
          ...(teamId ? { defaultTeamId: teamId } : {}),
        })
        .returning();

      const insertedUser = insertedUsers[0];
      if (!insertedUser) throw new Error('Failed to create user account');
      newUser = insertedUser;

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
        .where(and(eq(userInvites.id, invite.id), eq(userInvites.status, 'pending')));
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
      { status: error.statusCode || (error.code === '23505' ? 409 : 500) }
    );
  }
}
