import { NextRequest, NextResponse } from "next/server";
import { requireClientReviewer, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { getApprovedClientSafeReport, renderClientSafeReportHtml } from "@/lib/agency-report-service";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireClientReviewer(request);
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return await runWithAuthenticatedTeamContext(auth, async () => {
      const report = await getApprovedClientSafeReport(auth.teamId, id);
      if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
      return new NextResponse(renderClientSafeReportHtml(report.clientSafeSnapshot), { headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="client-report-${id}.html"`,
        "X-Content-Type-Options": "nosniff",
      } });
    });
  } catch (error: any) {
    const status = error?.statusCode ?? 500;
    if (status >= 500) console.error("[client/reports/id/download GET]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to download report" : error.message }, { status });
  }
}