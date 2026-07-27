import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyBriefs, dailyBriefDeliveries, dailyBriefPreferences, users, teamMembers } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { addDailyBriefJob } from "@/lib/queue";

/** GET /api/admin/briefs?date=YYYY-MM-DD
 *  Returns brief stats + per-user status for a given date (defaults to UTC today) */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || new Date().toISOString().slice(0, 10);

    // All briefs for this date with user info
    const briefs = await db
      .select({
        brief: dailyBriefs,
        user: {
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          accountStatus: users.accountStatus,
        },
        prefs: {
          cadence: dailyBriefPreferences.cadence,
          timezone: dailyBriefPreferences.timezone,
          sendHourLocal: dailyBriefPreferences.sendHourLocal,
          emailEnabled: dailyBriefPreferences.emailEnabled,
          inAppEnabled: dailyBriefPreferences.inAppEnabled,
        },
      })
      .from(dailyBriefs)
      .innerJoin(users, eq(dailyBriefs.userId, users.id))
      .leftJoin(dailyBriefPreferences, eq(dailyBriefPreferences.userId, users.id))
      .where(eq(dailyBriefs.localDate, date))
      .orderBy(desc(dailyBriefs.generatedAt));

    // All users with brief preferences (to show those who have no brief yet today)
    const allPrefs = await db
      .select({
        userId: dailyBriefPreferences.userId,
        teamId: dailyBriefPreferences.teamId,
        cadence: dailyBriefPreferences.cadence,
        timezone: dailyBriefPreferences.timezone,
        sendHourLocal: dailyBriefPreferences.sendHourLocal,
        emailEnabled: dailyBriefPreferences.emailEnabled,
        email: users.email,
        fullName: users.fullName,
        accountStatus: users.accountStatus,
      })
      .from(dailyBriefPreferences)
      .innerJoin(users, eq(dailyBriefPreferences.userId, users.id))
      .orderBy(users.email);

    // Delivery log for these briefs
    const briefIds = briefs.map(b => b.brief.id);
    let deliveries: any[] = [];
    if (briefIds.length > 0) {
      deliveries = await db
        .select()
        .from(dailyBriefDeliveries)
        .where(sql`${dailyBriefDeliveries.briefId} = ANY(${sql.raw(`ARRAY[${briefIds.join(',')}]::int[]`)})`)
        .orderBy(desc(dailyBriefDeliveries.sentAt));
    }

    // Aggregate stats
    const generated = briefs.filter(b => b.brief.status === 'generated').length;
    const failed = briefs.filter(b => b.brief.status === 'failed').length;
    const generating = briefs.filter(b => b.brief.status === 'generating').length;
    const viewed = briefs.filter(b => b.brief.viewedAt !== null).length;
    const emailed = briefs.filter(b => b.brief.emailedAt !== null).length;

    return NextResponse.json({
      date,
      stats: {
        total: briefs.length,
        generated,
        failed,
        generating,
        viewed,
        emailed,
        usersWithPrefs: allPrefs.length,
        noBriefToday: allPrefs.length - briefs.length,
      },
      briefs: briefs.map(b => ({
        ...b.brief,
        userEmail: b.user.email,
        userFullName: b.user.fullName,
        userStatus: b.user.accountStatus,
        prefs: b.prefs,
      })),
      allPrefs,
      deliveries,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}

/** POST /api/admin/briefs
 *  Force-generate a brief for a specific user or all users in a team */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json();
    const { userId, teamId, date } = body;

    const localDate = date || new Date().toISOString().slice(0, 10);

    if (userId) {
      // Single user
      const [membership] = await db
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId))
        .limit(1);

      if (!membership) {
        return NextResponse.json({ error: "User has no team" }, { status: 400 });
      }

      await addDailyBriefJob({ userId, teamId: membership.teamId, localDate, force: true });
      return NextResponse.json({ success: true, enqueued: 1 });
    }

    if (teamId) {
      const members = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));

      for (const m of members) {
        await addDailyBriefJob({ userId: m.userId, teamId, localDate, force: true });
      }
      return NextResponse.json({ success: true, enqueued: members.length });
    }

    return NextResponse.json({ error: "Provide userId or teamId" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: error.statusCode || 500 }
    );
  }
}
