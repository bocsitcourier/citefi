import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { withAuthenticatedTeamAdminContext } from "@/lib/api/auth";
import {
  AgencyReportSchemaNotReadyError,
  createAgencyClientReport,
  sanitizeClientSnapshot,
} from "@/lib/agency-report-service";

export async function POST(request: NextRequest) {
  try {
    return await withAuthenticatedTeamAdminContext(request, async () => {
      const input = await request.json();
      const result = await createAgencyClientReport(input);
      return NextResponse.json({
        report: result.report,
        inserted: result.inserted,
        preview: sanitizeClientSnapshot(result.report.clientSafeSnapshot),
        rebilling: result.report.agencyRebillingSnapshot,
      }, { status: result.inserted ? 201 : 200 });
    });
  } catch (error: any) {
    const schemaNotReady = error instanceof AgencyReportSchemaNotReadyError;
    const status = schemaNotReady ? 503
      : error instanceof ZodError || error instanceof SyntaxError ? 400
      : error?.statusCode ?? (/must be approved/i.test(error?.message) ? 409
        : /not found|direct child/i.test(error?.message) ? 404 : 500);
    if (status >= 500) console.error("[agency/reports/generate POST]", error);
    return NextResponse.json({
      error: error instanceof ZodError ? error.flatten()
        : status >= 500 && !schemaNotReady ? "Failed to generate report" : error.message,
    }, { status });
  }
}