import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityLogs, users } from "@/shared/schema";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = parseInt(searchParams.get("offset") || "0");
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
      conditions.push(gte(activityLogs.createdAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(activityLogs.createdAt, new Date(endDate)));
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

    return NextResponse.json(logs);
  } catch (error) {
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
