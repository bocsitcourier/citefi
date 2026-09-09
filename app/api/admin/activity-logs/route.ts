import { NextRequest, NextResponse } from "next/server";
import { systemDb as db } from "@/lib/db";
import { activityLogs, users } from "@/shared/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { requireAdmin, requireRecentAdminMfa } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const includeSensitive = searchParams.get("includeSensitive") === "true";
    if (includeSensitive) {
      await requireRecentAdminMfa(req);
    }
    const parsedLimit = Number.parseInt(searchParams.get("limit") || "100", 10);
    const parsedOffset = Number.parseInt(searchParams.get("offset") || "0", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 100;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    const action = searchParams.get("action");
    const severity = searchParams.get("severity");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const conditions = [];

    if (action && action !== "all") {
      conditions.push(eq(activityLogs.action, action));
    }
    if (severity && severity !== "all") {
      conditions.push(eq(activityLogs.severity, severity));
    }
    if (startDate) {
      const parsed = new Date(startDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
      }
      conditions.push(gte(activityLogs.createdAt, parsed));
    }
    if (endDate) {
      const parsed = new Date(endDate);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
      }
      conditions.push(lte(activityLogs.createdAt, parsed));
    }

    const logs = await db
      .select({
        id: activityLogs.id,
        userId: activityLogs.userId,
        teamId: activityLogs.teamId,
        userEmail: users.email,
        userName: users.fullName,
        action: activityLogs.action,
        resource: activityLogs.resource,
        resourceId: activityLogs.resourceId,
        targetType: activityLogs.targetType,
        targetPublicId: activityLogs.targetPublicId,
        ipAddress: activityLogs.ipAddress,
        userAgent: activityLogs.userAgent,
        details: activityLogs.details,
        severity: activityLogs.severity,
        createdAt: activityLogs.createdAt,
      })
      .from(activityLogs)
      .leftJoin(users, eq(activityLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);

    const response = logs.map((entry) => ({
      ...entry,
      ipAddress: includeSensitive ? entry.ipAddress : null,
      userAgent: includeSensitive ? entry.userAgent : null,
      details: includeSensitive ? entry.details : null,
    }));
    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Sensitive-Fields": includeSensitive ? "included" : "redacted",
      },
    });
  } catch (error: any) {
    console.error("Get activity logs error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch activity logs";
    let status = 500;
    if (
      message === "Authentication required" ||
      message === "No authentication token provided" ||
      message === "Invalid or expired token"
    ) {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    }
    return NextResponse.json({ error: message }, { status });
  }
}
