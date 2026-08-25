import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { sendApprovedAgencyReport } from "@/lib/agency-report-service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireTeamAdmin(request);
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return await runWithAuthenticatedTeamContext(auth, async () =>
      NextResponse.json(await sendApprovedAgencyReport(id)));
  } catch (error: any) {
    const status = error?.statusCode ?? (/not found/i.test(error?.message) ? 404
      : /must be approved|No report recipients/i.test(error?.message) ? 409 : 500);
    if (status >= 500) console.error("[agency/reports/id/send POST]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to send report" : error.message }, { status });
  }
}