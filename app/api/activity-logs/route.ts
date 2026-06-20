import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityLogs, teamMembers } from "@/shared/schema";
import { desc, eq, and, or, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireTeamMember } from "@/lib/api/auth";

// GET /api/activity-logs - Query activity logs with team filtering
export async function GET(request: NextRequest) {
  try {
    const { userId: authUserId, teamId: authTeamId } = await requireTeamMember(request);
    const { searchParams } = new URL(request.url);
    
    // Parse query parameters
    const teamId = searchParams.get("teamId") ? parseInt(searchParams.get("teamId")!) : null;
    const userId = searchParams.get("userId") ? parseInt(searchParams.get("userId")!) : null;
    const action = searchParams.get("action");
    const severity = searchParams.get("severity");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build query conditions
    const conditions = [];
    
    if (teamId !== null) {
      conditions.push(eq(activityLogs.teamId, teamId));
    }
    
    if (userId !== null) {
      conditions.push(eq(activityLogs.userId, userId));
    }
    
    if (action) {
      conditions.push(eq(activityLogs.action, action));
    }
    
    if (severity) {
      conditions.push(eq(activityLogs.severity, severity as any));
    }

    // Fetch logs with optional filters
    const logs = await db
      .select()
      .from(activityLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activityLogs.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return NextResponse.json({
      logs,
      pagination: {
        total: countResult?.count ?? 0,
        limit,
        offset,
        hasMore: offset + limit < (countResult?.count ?? 0),
      },
    });
  } catch (error: any) {
    console.error("Failed to fetch activity logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity logs" },
      { status: error?.statusCode || 500 }
    );
  }
}

// POST /api/activity-logs - Create a new activity log entry
const createLogSchema = z.object({
  userId: z.number().optional(),
  teamId: z.number().optional(),
  action: z.string().min(1, "Action is required"),
  resource: z.string().optional(),
  resourceId: z.number().optional(),
  targetType: z.string().optional(),
  targetPublicId: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  details: z.any().optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).default("info"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createLogSchema.parse(body);

    // TODO: Get userId and teamId from session/auth when available
    // For now, accept from request body
    
    // Validate team membership if both userId and teamId provided
    if (data.userId && data.teamId) {
      const [membership] = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, data.userId),
            eq(teamMembers.teamId, data.teamId)
          )
        )
        .limit(1);

      if (!membership) {
        return NextResponse.json(
          { error: "User is not a member of the specified team" },
          { status: 403 }
        );
      }
    }

    // Create activity log
    const [log] = await db
      .insert(activityLogs)
      .values({
        userId: data.userId || null,
        teamId: data.teamId || null,
        action: data.action,
        resource: data.resource || null,
        resourceId: data.resourceId || null,
        targetType: data.targetType || null,
        targetPublicId: data.targetPublicId || null,
        ipAddress: data.ipAddress || null,
        userAgent: data.userAgent || null,
        details: data.details || null,
        severity: data.severity,
      })
      .returning();

    return NextResponse.json(
      {
        success: true,
        log,
        message: "Activity log created successfully",
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error("Failed to create activity log:", error);
    return NextResponse.json(
      {
        error: "Failed to create activity log",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: error?.statusCode || 500 }
    );
  }
}
