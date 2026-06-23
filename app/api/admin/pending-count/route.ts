import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { users } from "@/shared/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.accountStatus, "pending_approval"));

    const count = result[0]?.count ?? 0;
    return NextResponse.json({ count });
  } catch (error: any) {
    if (error?.statusCode === 401 || error?.statusCode === 403) {
      return NextResponse.json({ error: "Unauthorized" }, { status: error.statusCode });
    }
    console.error("Failed to fetch pending approvals count:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
