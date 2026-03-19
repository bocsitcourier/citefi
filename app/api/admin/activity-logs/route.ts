import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adminActionLogs, users } from "@/shared/schema";
import { eq, desc, like, or, and, gte, lte } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const action = searchParams.get("action");
    const adminUserId = searchParams.get("adminUserId");
    const targetUserId = searchParams.get("targetUserId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    let conditions = [];

    if (action) {
      conditions.push(eq(adminActionLogs.action, action));
    }

    if (adminUserId) {
      conditions.push(eq(adminActionLogs.userId, parseInt(adminUserId)));
    }

    if (targetUserId) {
      conditions.push(eq(adminActionLogs.targetId, parseInt(targetUserId)));
    }

    if (startDate) {
      conditions.push(gte(adminActionLogs.createdAt, new Date(startDate)));
    }

    if (endDate) {
      conditions.push(lte(adminActionLogs.createdAt, new Date(endDate)));
    }

    const logs = await db
      .select({
        id: adminActionLogs.id,
        adminUserId: adminActionLogs.userId,
        adminEmail: users.email,
        adminName: users.fullName,
        action: adminActionLogs.action,
        targetType: adminActionLogs.targetType,
        targetId: adminActionLogs.targetId,
        details: adminActionLogs.details,
        createdAt: adminActionLogs.createdAt,
      })
      .from(adminActionLogs)
      .leftJoin(users, eq(adminActionLogs.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(adminActionLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json(logs);
  } catch (error) {
    console.error("Get activity logs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch activity logs" },
      { status: 500 }
    );
  }
}
