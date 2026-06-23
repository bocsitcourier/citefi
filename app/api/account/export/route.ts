import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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
import { requireAuth } from "@/lib/api/auth";
import { rateLimitDb } from "@/lib/db-rate-limit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { userId, teamId } = await requireAuth(req);

    const rlResult = await rateLimitDb(`export:${userId}`, 3, 60 * 60);
    if (!rlResult.allowed) {
      return NextResponse.json(
        { error: "Export rate limit reached. You may request up to 3 exports per hour." },
        { status: 429, headers: { "Retry-After": String(rlResult.retryAfter ?? 3600) } }
      );
    }

    const [user] = await db
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

    const teamData = teamId
      ? await db
          .select({ id: teams.id, name: teams.name, billingPlan: teams.billingPlan, createdAt: teams.createdAt })
          .from(teams)
          .where(eq(teams.id, teamId))
          .limit(1)
      : [];

    const teamMemberships = await db
      .select({ teamId: teamMembers.teamId, role: teamMembers.role, joinedAt: teamMembers.joinedAt })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId));

    const recentActivity = await db
      .select({ action: activityLogs.action, resource: activityLogs.resource, createdAt: activityLogs.createdAt })
      .from(activityLogs)
      .where(eq(activityLogs.userId, userId))
      .orderBy(desc(activityLogs.createdAt))
      .limit(100);

    const recentLogins = await db
      .select({ ipAddress: loginHistory.ipAddress, success: loginHistory.success, createdAt: loginHistory.createdAt })
      .from(loginHistory)
      .where(eq(loginHistory.userId, userId))
      .orderBy(desc(loginHistory.createdAt))
      .limit(50);

    const batches = teamId
      ? await db
          .select({ id: jobBatches.id, coreTopic: jobBatches.coreTopic, status: jobBatches.status, createdAt: jobBatches.createdAt })
          .from(jobBatches)
          .where(eq(jobBatches.teamId, teamId))
          .orderBy(desc(jobBatches.createdAt))
          .limit(200)
      : [];

    const userArticles = teamId
      ? await db
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
          .limit(500)
      : [];

    await db.insert(activityLogs).values({
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
      team: teamData[0] ?? null,
      memberships: teamMemberships,
      recentActivity,
      recentLogins,
      contentBatches: batches,
      articles: userArticles,
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
