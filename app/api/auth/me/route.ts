import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/shared/schema";
import { verifyToken } from "@/lib/auth";
import { getTokenFromRequest } from "@/lib/api/auth";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized - No token provided" },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json(
        { error: "Unauthorized - Invalid or expired token" },
        { status: 401 }
      );
    }

    // Fetch current user data
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        role: users.role,
        profilePictureUrl: users.profilePictureUrl,
        twoFactorEnabled: users.twoFactorEnabled,
        twoFactorMethod: users.twoFactorMethod,
        emailVerified: users.emailVerified,
        accountStatus: users.accountStatus,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (user.accountStatus !== "active") {
      return NextResponse.json(
        { error: "Account is not active" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        profilePictureUrl: user.profilePictureUrl,
        twoFactorEnabled: user.twoFactorEnabled === 1,
        twoFactorMethod: user.twoFactorMethod,
        emailVerified: user.emailVerified === 1,
        accountStatus: user.accountStatus,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
    });

  } catch (error) {
    console.error("Get current user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
