import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loginHistory, users } from "@/shared/schema";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "100");
    const offset = parseInt(searchParams.get("offset") || "0");
    const userId = searchParams.get("userId");

    let query = db
      .select({
        id: loginHistory.id,
        userId: loginHistory.userId,
        userEmail: users.email,
        userName: users.fullName,
        ipAddress: loginHistory.ipAddress,
        userAgent: loginHistory.userAgent,
        success: loginHistory.success,
        failureReason: loginHistory.failureReason,
        createdAt: loginHistory.createdAt,
      })
      .from(loginHistory)
      .leftJoin(users, eq(loginHistory.userId, users.id))
      .orderBy(desc(loginHistory.createdAt))
      .limit(limit)
      .offset(offset);

    if (userId) {
      query = query.where(eq(loginHistory.userId, parseInt(userId))) as typeof query;
    }

    const history = await query;

    return NextResponse.json(history);
  } catch (error: any) {
    console.error("Get login history error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch login history" },
      { status: error?.statusCode || 500 }
    );
  }
}
