import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobEvents } from "@/shared/schema";
import { desc, eq, and, sql } from "drizzle-orm";

// MVP: Using job_events for error tracking
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const severity = searchParams.get("severity");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    let query = db.select().from(jobEvents).$dynamic();

    // Apply filters
    const conditions = [];
    if (severity) {
      conditions.push(eq(jobEvents.severity, severity));
    } else {
      // Default to errors only
      conditions.push(eq(jobEvents.severity, 'error'));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const results = await query
      .orderBy(desc(jobEvents.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(jobEvents).$dynamic();
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions));
    }
    const countResult = await countQuery;
    const count = countResult[0]?.count ?? 0;

    return NextResponse.json({
      errors: results,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Admin errors fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch errors" },
      { status: 500 }
    );
  }
}
