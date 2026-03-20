import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userQuotas, adminActionLogs } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

const quotaUpdateSchema = z.object({
  quotaType: z.string(),
  limitValue: z.number().int().min(0).max(100000),
  periodType: z.enum(['hour', 'day', 'week', 'month']).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
});

const quotaCreateSchema = z.object({
  quotaType: z.string(),
  limitValue: z.number().int().min(0).max(100000),
  periodType: z.enum(['hour', 'day', 'week', 'month']),
  enabled: z.number().int().min(0).max(1).default(1),
});

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin(req);
    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.userId);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const quotas = await db
      .select()
      .from(userQuotas)
      .where(eq(userQuotas.userId, userId));

    return NextResponse.json(quotas);
  } catch (error: unknown) {
    console.error("Get user quotas error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to fetch user quotas";
    let status = 500;
    
    if (message === "Authentication required" || message === "No authentication token provided" || message === "Invalid or expired token") {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error && typeof error === 'object' && 'statusCode' in error) {
      status = (error as { statusCode: number }).statusCode;
    }
    
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const adminUserId = await requireAdmin(req);
    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.userId);
    const body = await req.json();

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const validationResult = quotaUpdateSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid quota values provided", details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { quotaType, limitValue, periodType, enabled } = validationResult.data;

    const [existingQuota] = await db
      .select()
      .from(userQuotas)
      .where(and(
        eq(userQuotas.userId, userId),
        eq(userQuotas.quotaType, quotaType)
      ))
      .limit(1);

    if (existingQuota) {
      const updateData: Record<string, unknown> = {
        limitValue,
        updatedAt: new Date(),
      };
      if (periodType !== undefined) updateData.periodType = periodType;
      if (enabled !== undefined) updateData.enabled = enabled;

      await db
        .update(userQuotas)
        .set(updateData)
        .where(and(
          eq(userQuotas.userId, userId),
          eq(userQuotas.quotaType, quotaType)
        ));
    } else {
      const now = new Date();
      const periodEnd = new Date(now);
      if (periodType === 'hour') {
        periodEnd.setHours(periodEnd.getHours() + 1);
      } else if (periodType === 'day') {
        periodEnd.setDate(periodEnd.getDate() + 1);
      } else if (periodType === 'week') {
        periodEnd.setDate(periodEnd.getDate() + 7);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      await db.insert(userQuotas).values({
        userId,
        quotaType,
        limitValue,
        periodType: periodType || 'day',
        currentUsage: 0,
        periodStartsAt: now,
        periodEndsAt: periodEnd,
        enabled: enabled ?? 1,
      });
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'quota_updated',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({
        quotaType,
        limitValue,
        periodType,
        enabled,
        ipAddress: clientIp,
      }),
    });

    return NextResponse.json({
      success: true,
      message: "Quota updated successfully",
    });
  } catch (error: unknown) {
    console.error("Update quota error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to update quota";
    let status = 500;
    
    if (message === "Authentication required" || message === "No authentication token provided" || message === "Invalid or expired token") {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error && typeof error === 'object' && 'statusCode' in error) {
      status = (error as { statusCode: number }).statusCode;
    }
    
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const adminUserId = await requireAdmin(req);
    const resolvedParams = await params;
    const userId = parseInt(resolvedParams.userId);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    await db
      .update(userQuotas)
      .set({
        currentUsage: 0,
        periodStartsAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userQuotas.userId, userId));

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    await db.insert(adminActionLogs).values({
      userId: adminUserId,
      action: 'quota_reset',
      targetType: 'user',
      targetId: userId,
      details: JSON.stringify({ 
        reason: 'Manual reset by admin',
        ipAddress: clientIp,
      }),
    });

    return NextResponse.json({
      success: true,
      message: "Quota usage reset successfully",
    });
  } catch (error: unknown) {
    console.error("Reset quota error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to reset quota";
    let status = 500;
    
    if (message === "Authentication required" || message === "No authentication token provided" || message === "Invalid or expired token") {
      status = 401;
    } else if (message === "Admin access required") {
      status = 403;
    } else if (error && typeof error === 'object' && 'statusCode' in error) {
      status = (error as { statusCode: number }).statusCode;
    }
    
    return NextResponse.json({ error: message }, { status });
  }
}
