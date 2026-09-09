import { NextRequest, NextResponse } from "next/server";
import { db, systemDb } from "@/lib/db";
import {
  users,
  teams,
  teamMembers,
  activityLogs,
  loginHistory,
  jobBatches,
  articles,
  socialPosts,
} from "@/shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { rateLimitDb } from "@/lib/db-rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const auth = await requireAuth(req);
    const { userId, teamId } = auth;

    const rlResult = await rateLimitDb(`export:${userId}`, 3, 60 * 60 * 1000);
    if (!rlResult.allowed) {
      return NextResponse.json(
        { error: "Export rate limit reached. You may request up to 3 exports per hour." },
        { status: 429, headers: { "Retry-After": String(rlResult.retryAfter ?? 3600) } }
      );
    }

    const [user] = await systemDb
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        emailVerified: users.emailVerified,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorMethod: users.twoFactorMethod,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const teamMemberships = await systemDb
      .select({ teamId: teamMembers.teamId, role: teamMembers.role, joinedAt: teamMembers.joinedAt })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));

    const recentActivity = await systemDb
      .select({ action: activityLogs.action, resource: activityLogs.resource, createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(100);

    const recentLogins = await systemDb
      .select({ ipAddress: loginHistory.ipAddress, success: loginHistory.success, createdAt: loginHistory.createdAt })
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(50);

    const tenantData = teamId
      ? await runWithAuthenticatedTeamContext(
          { userId, teamId, role: auth.role },
          async () => {
            const teamData = await db
              .select({ id: teams.id, name: teams.name, billingPlan: teams.billingPlan, createdAt: teams.createdAt })
              .from(teams)
              .where(eq(teams.id, teamId))
              .limit(1);
            const batches = await db
              .select({ id: jobBatches.id, coreTopic: jobBatches.coreTopic, status: jobBatches.status, createdAt: jobBatches.createdAt })
              .from(jobBatches)
              .where(eq(jobBatches.teamId, teamId))
              .orderBy(desc(jobBatches.createdAt))
              .limit(200);
            const userArticles = await db
              .select({
                id: articles.id,
                chosenTitle: articles.chosenTitle,
                slug: articles.slug,
                articleStatus: articles.articleStatus,
                approvalStatus: articles.approvalStatus,
                wordCount: articles.wordCount,
                createdAt: articles.createdAt,
              })
              .from(articles)
              .where(eq(articles.teamId, teamId))
              .orderBy(desc(articles.createdAt))
              .limit(500);
            return { teamData, batches, userArticles };
          },
        )
      : { teamData: [], batches: [], userArticles: [] };

    await systemDb.insert(activityLogs).values({
      userId,
      action: "account_data_export",
      resource: "account",
      details: `Data export requested from ${ip}`,
    }).catch(() => {});

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      exportVersion: "1.0",
      notice: "This export contains your personal account data. Secrets, passwords, tokens, and OAuth credentials are excluded.",
      profile: user,
      team: tenantData.teamData[0] ?? null,
      memberships: teamMemberships,
      recentActivity,
      recentLogins,
      contentBatches: tenantData.batches,
      articles: tenantData.userArticles,
    };

    const json = JSON.stringify(exportPayload, null, 2);
    const filename = `citefi-export-${user.email.replace(/[^a-z0-9]/gi, "_")}-${new Date().toISOString().split("T")[0]}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    if (err?.status === 401 || err?.statusCode === 401) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[account/export]", err);
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }
}
