import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { createAgencyClientReport, sanitizeClientSnapshot } from "@/lib/agency-report-service";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTeamAdmin(request);
    const input = await request.json();
    return await runWithAuthenticatedTeamContext(auth, async () => {
      const result = await createAgencyClientReport(input);
      return NextResponse.json({
        report: result.report,
        inserted: result.inserted,
        preview: sanitizeClientSnapshot(result.report.clientSafeSnapshot),
        rebilling: result.report.agencyRebillingSnapshot,
      }, { status: result.inserted ? 201 : 200 });
    });
  } catch (error: any) {
    const status = error instanceof ZodError || error instanceof SyntaxError ? 400
      : error?.statusCode ?? (/must be approved/i.test(error?.message) ? 409
        : /not found|direct child/i.test(error?.message) ? 404 : 500);
    if (status >= 500) console.error("[agency/reports/generate POST]", error);
    return NextResponse.json({
      error: error instanceof ZodError ? error.flatten() : status >= 500 ? "Failed to generate report" : error.message,
    }, { status });
  }
}