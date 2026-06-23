import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, teamMembers, teams, activityLogs, loginHistory, creditBalances } from "@/shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userIdParam } = await params;
    const userId = parseInt(userIdParam);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    await requireAdmin(req);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        accountStatus: users.accountStatus,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorMethod: users.twoFactorMethod,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        defaultTeamId: users.defaultTeamId,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [membership] = await db
      .select({
        teamId: teamMembers.teamId,
        memberRole: teamMembers.role,
        joinedAt: teamMembers.joinedAt,
        teamName: teams.name,
        billingPlan: teams.billingPlan,
        billingStatus: teams.billingStatus,
        cancelAtPeriodEnd: teams.cancelAtPeriodEnd,
        currentPeriodEnd: teams.currentPeriodEnd,
        stripeCustomerId: teams.stripeCustomerId,
        stripeSubscriptionId: teams.stripeSubscriptionId,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, userId))
      .limit(1);

    const billing = membership
      ? {
          teamId: membership.teamId,
          teamName: membership.teamName,
          memberRole: membership.memberRole,
          joinedAt: membership.joinedAt,
          billingPlan: membership.billingPlan,
          billingStatus: membership.billingStatus,
          cancelAtPeriodEnd: membership.cancelAtPeriodEnd,
          currentPeriodEnd: membership.currentPeriodEnd,
          stripeCustomerId: membership.stripeCustomerId
            ? `cus_...${membership.stripeCustomerId.slice(-4)}`
            : null,
          stripeSubscriptionId: membership.stripeSubscriptionId
            ? `sub_...${membership.stripeSubscriptionId.slice(-6)}`
            : null,
        }
      : null;

    const credits = membership
      ? await db
          .select()
          .from(creditBalances)
          .where(eq(creditBalances.teamId, membership.teamId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;

    const recentActivity = await db
      .select({
        id: activityLogs.id,
        action: activityLogs.action,
        resource: activityLogs.resource,
        severity: activityLogs.severity,
        ipAddress: activityLogs.ipAddress,
        createdAt: activityLogs.createdAt,
        details: activityLogs.details,
      })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(20);

    const recentLogins = await db
      .select({
        id: loginHistory.id,
        success: loginHistory.success,
        failureReason: loginHistory.failureReason,
        ipAddress: loginHistory.ipAddress,
        userAgent: loginHistory.userAgent,
        country: loginHistory.country,
        city: loginHistory.city,
        browser: loginHistory.browser,
        os: loginHistory.os,
        deviceType: loginHistory.deviceType,
        createdAt: loginHistory.createdAt,
      })
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(10);

    const totalCredits = credits
      ? Math.max(
          0,
          (credits.allowanceCredits - credits.allowanceUsed) +
          (credits.purchasedCredits - credits.purchasedUsed) -
          credits.reservedCredits
        )
      : 0;

    const articleCount = recentActivity.filter((a) =>
      a.action?.includes("generate") || a.action?.includes("article") || a.action?.includes("content")
    ).length;

    return NextResponse.json({
      user,
      billing,
      credits: { totalRemaining: totalCredits, raw: credits },
      recentActivity,
      recentLogins,
      articleCount,
    });
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[admin/users/[id]/detail]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
