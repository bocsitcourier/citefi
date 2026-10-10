import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Process liveness is intentionally separate from operational readiness.
// This must never replace /api/health in a deployment acceptance check.
export async function GET() {
  return NextResponse.json(
    { status: "alive", scope: "process-only", readiness: "not-assessed" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
