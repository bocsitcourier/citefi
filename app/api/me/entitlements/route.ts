import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { getUserEntitlements } from "@/lib/user-gate";

/**
 * GET /api/me/entitlements
 *
 * Returns per-user content quotas, concurrency caps, and platform breaker state.
 * Every Generate button across web/mobile derives its enabled/disabled state
 * from this endpoint — no client hardcodes quota numbers.
 *
 * Response shape:
 * {
 *   video:   { remaining, cap, inFlight, concurrencyCap, resetsAt }
 *   article: { remaining, cap, inFlight, concurrencyCap, resetsAt }
 *   platform: { status: "ok"|"video_paused"|"generation_paused", message? }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const entitlements = await getUserEntitlements(userId, teamId);
    return NextResponse.json(entitlements);
  } catch (error: unknown) {
    if (error instanceof Error && "statusCode" in error) {
      const e = error as Error & { statusCode: number };
      return NextResponse.json({ error: e.message }, { status: e.statusCode });
    }
    console.error("[entitlements] failed:", error);
    return NextResponse.json({ error: "Failed to load entitlements" }, { status: 500 });
  }
}
