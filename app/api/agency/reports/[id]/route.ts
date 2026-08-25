import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { getAgencyReportDetail } from "@/lib/agency-report-service";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTeamAdmin(request);
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return await runWithAuthenticatedTeamContext(auth, async () => {
      const detail = await getAgencyReportDetail(id);
      if (!detail) return NextResponse.json({ error: "Report not found" }, { status: 404 });
      return NextResponse.json(detail);
    });
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status >= 500) console.error("[agency/reports/id GET]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to load report" : error.message }, { status });
  }
}