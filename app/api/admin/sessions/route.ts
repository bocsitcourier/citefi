import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sessions, users } from "@/shared/schema";
import { eq, isNull, gt, and, desc } from "drizzle-orm";
import { requireAdmin } from "@/lib/api/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const activeSessions = await db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        userEmail: users.email,
        userName: users.fullName,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        lastActivityAt: sessions.lastActivityAt,
        forceLogoutAt: sessions.forceLogoutAt,
      })
      .from(sessions)
      .leftJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.isActive, 1),
          isNull(sessions.forceLogoutAt),
          gt(sessions.expiresAt, new Date())
        )
      )
      .orderBy(desc(sessions.lastActivityAt));

    return NextResponse.json(activeSessions);
  } catch (error: any) {
    console.error("Get sessions error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch sessions" },
      { status: error?.statusCode ?? 500 }
    );
  }
}
