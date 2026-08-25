import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { listAgencyReports } from "@/lib/agency-report-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTeamAdmin(request);
    const clientTeamId = Number(new URL(request.url).searchParams.get("clientTeamId"));
    if (!Number.isSafeInteger(clientTeamId) || clientTeamId <= 0) {
      return NextResponse.json({ error: "Invalid clientTeamId" }, { status: 400 });
    }
    return await runWithAuthenticatedTeamContext(auth, async () =>
      NextResponse.json(await listAgencyReports(clientTeamId)));
  } catch (error: any) {
    const status = error?.statusCode ?? (/direct child/.test(error?.message) ? 404 : 500);
    if (status >= 500) console.error("[agency/reports GET]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to load reports" : error.message }, { status });
  }
}