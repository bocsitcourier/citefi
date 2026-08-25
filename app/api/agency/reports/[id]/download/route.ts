import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import {
  getAgencyReportDetail, recordAgencyReportDelivery, renderAgencyRebillingCsv,
  renderClientSafeReportHtml,
} from "@/lib/agency-report-service";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTeamAdmin(request);
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    const kind = new URL(request.url).searchParams.get("kind") ?? "report";
    if (kind !== "report" && kind !== "rebilling") {
      return NextResponse.json({ error: "kind must be report or rebilling" }, { status: 400 });
    }
    return await runWithAuthenticatedTeamContext(auth, async () => {
      const detail = await getAgencyReportDetail(id);
      if (!detail) return NextResponse.json({ error: "Report not found" }, { status: 404 });
      if (kind === "rebilling" && !["approved", "sent"].includes(detail.report.status)) {
        return NextResponse.json({ error: "Report must be approved before rebilling export" }, { status: 409 });
      }
      const body = kind === "report"
        ? renderClientSafeReportHtml(detail.report.clientSafeSnapshot)
        : renderAgencyRebillingCsv(detail.report.agencyRebillingSnapshot);
      const extension = kind === "report" ? "html" : "csv";
      const idempotencyKey = request.headers.get("x-idempotency-key")
        ?? `download:${kind}:${id}:${Date.now()}`;
      await recordAgencyReportDelivery({
        reportId: id, channel: "download", recipient: `user:${auth.userId}`,
        status: "delivered", idempotencyKey,
      });
      return new NextResponse(body, { headers: {
        "Content-Type": kind === "report" ? "text/html; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="agency-report-${id}-${kind}.${extension}"`,
        "X-Content-Type-Options": "nosniff",
      } });
    });
  } catch (error: any) {
    const unavailable = /not available/.test(error?.message);
    const status = error?.statusCode ?? (/not found/i.test(error?.message) ? 404 : unavailable ? 409 : 500);
    if (status >= 500) console.error("[agency/reports/id/download GET]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to download report" : error.message }, { status });
  }
}