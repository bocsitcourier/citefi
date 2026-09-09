import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { getCreditBalance } from "@/lib/credits";

export async function GET(request: NextRequest) {
  try {
    return await withAuthenticatedTeamContext(request, async ({ teamId }) => {
    const balance = await getCreditBalance(teamId);
    return NextResponse.json({ balance, teamId });
    });
  } catch (err: any) {
    const msg = err?.message ?? "Unknown error";
    if (msg === "Authentication required") return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === "Admin access required") return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: err?.statusCode || 500 });
  }
}
