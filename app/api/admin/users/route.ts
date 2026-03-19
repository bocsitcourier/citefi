import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/shared/schema";
import { requireAdmin } from "@/lib/api/auth";
import { desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    // Verify admin access
    await requireAdmin(req);

    // Fetch all users ordered by creation date
    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        accountStatus: users.accountStatus,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return NextResponse.json(allUsers);
  } catch (error: any) {
    console.error("Get users error:", error);
    
    if (error.statusCode === 403 || error.message === "Admin access required") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    if (error.statusCode === 401 || 
        error.message === "Authentication required" ||
        error.message === "No authentication token provided" || 
        error.message === "Invalid or expired token" ||
        error.message === "Account is not active") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
