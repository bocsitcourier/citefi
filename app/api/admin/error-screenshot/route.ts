import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";

// This admin endpoint is kept for backward compatibility but the active
// implementation has moved to /api/client/error-screenshot (requireAuth).
// Only admins can reach this path now.
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    return NextResponse.json(
      { error: "Use /api/client/error-screenshot for client-side error reporting." },
      { status: 410 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: "Forbidden" }, { status: err?.statusCode || 403 });
  }
}
