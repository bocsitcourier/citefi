import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userQuotas, adminActionLogs } from "@/shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";
import { z } from "zod";

interface RouteParams {
  params: Promise<{ userId: string }>;
}

const VALID_QUOTA_TYPES = [
  'articles_per_hour',
  'articles_per_day',
  'articles_per_week',
  'articles_per_month',
  'social_posts_per_day',
  'social_posts_per_week',
  'social_posts_per_month',
  'videos_per_day',
  'videos_per_week',
  'videos_per_month',
  'podcasts_per_day',
  'podcasts_per_month',
  'api_calls_per_hour',
  'api_calls_per_day',
] as const;

const quotaUpdateSchema = z.object({
  quotaType: z.enum(VALID_QUOTA_TYPES),
  limitValue: z.number().int().min(0).max(100000),
  periodType: z.enum(['hour', 'day', 'week', 'month']).optional(),
  enabled: z.number().int().min(0).max(1).optional(),
});

const quotaCreateSchema = z.object({
  quotaType: z.enum(VALID_QUOTA_TYPES),
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

    // Atomic upsert — avoids TOCTOU race between concurrent admin PUT calls.
    // Requires the unique index on (userId, quotaType) in the schema.
    const now = new Date();
    const effectivePeriodType = periodType || 'day';
    const periodEnd = new Date(now);
    if (effectivePeriodType === 'hour') periodEnd.setHours(periodEnd.getHours() + 1);
    else if (effectivePeriodType === 'day') periodEnd.setDate(periodEnd.getDate() + 1);
    else if (effectivePeriodType === 'week') periodEnd.setDate(periodEnd.getDate() + 7);
    else periodEnd.setMonth(periodEnd.getMonth() + 1);

    await db.insert(userQuotas).values({
      userId,
      quotaType,
      limitValue,
      periodType: effectivePeriodType,
      currentUsage: 0,
      periodStartsAt: now,
      periodEndsAt: periodEnd,
      enabled: enabled ?? 1,
    }).onConflictDoUpdate({
      target: [userQuotas.userId, userQuotas.quotaType],
      set: {
        limitValue,
        updatedAt: new Date(),
        ...(periodType !== undefined ? { periodType } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

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
