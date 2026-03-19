import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userQuotas, users } from "@/shared/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const quotas = await db
      .select({
        id: userQuotas.id,
        userId: userQuotas.userId,
        userEmail: users.email,
        userName: users.fullName,
        role: userQuotas.role,
        quotaType: userQuotas.quotaType,
        limitValue: userQuotas.limitValue,
        periodType: userQuotas.periodType,
        currentUsage: userQuotas.currentUsage,
        periodStartsAt: userQuotas.periodStartsAt,
        periodEndsAt: userQuotas.periodEndsAt,
        enabled: userQuotas.enabled,
        createdAt: userQuotas.createdAt,
        updatedAt: userQuotas.updatedAt,
      })
      .from(userQuotas)
      .leftJoin(users, eq(userQuotas.userId, users.id));

    const groupedQuotas = quotas.reduce((acc, quota) => {
      const key = quota.userId?.toString() || `role_${quota.role}`;
      if (!acc[key]) {
        acc[key] = {
          userId: quota.userId,
          userEmail: quota.userEmail,
          userName: quota.userName,
          role: quota.role,
          quotas: [],
        };
      }
      acc[key].quotas.push({
        id: quota.id,
        quotaType: quota.quotaType,
        limitValue: quota.limitValue,
        periodType: quota.periodType,
        currentUsage: quota.currentUsage,
        periodStartsAt: quota.periodStartsAt,
        periodEndsAt: quota.periodEndsAt,
        enabled: quota.enabled,
      });
      return acc;
    }, {} as Record<string, {
      userId: number | null;
      userEmail: string | null;
      userName: string | null;
      role: string | null;
      quotas: Array<{
        id: number;
        quotaType: string;
        limitValue: number;
        periodType: string;
        currentUsage: number;
        periodStartsAt: Date;
        periodEndsAt: Date;
        enabled: number;
      }>;
    }>);

    return NextResponse.json(Object.values(groupedQuotas));
  } catch (error: unknown) {
    console.error("Get quotas error:", error);
    
    const message = error instanceof Error ? error.message : "Failed to fetch quotas";
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
