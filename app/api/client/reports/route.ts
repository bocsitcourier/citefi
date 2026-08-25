import { NextRequest, NextResponse } from "next/server";
import { requireClientReviewer, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { getApprovedClientSafeReports } from "@/lib/agency-report-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireClientReviewer(request);
    return await runWithAuthenticatedTeamContext(auth, async () =>
      NextResponse.json({ reports: await getApprovedClientSafeReports(auth.teamId) }));
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status >= 500) console.error("[client/reports GET]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to load reports" : error.message }, { status });
  }
}