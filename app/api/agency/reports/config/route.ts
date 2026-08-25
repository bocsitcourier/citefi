import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { upsertAgencyReportConfig } from "@/lib/agency-report-service";

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireTeamAdmin(request);
    const input = await request.json();
    return await runWithAuthenticatedTeamContext(auth, async () => {
      const config = await upsertAgencyReportConfig(input);
      return NextResponse.json({ config });
    });
  } catch (error: any) {
    const status = error instanceof ZodError ? 400
      : error instanceof SyntaxError ? 400
      : error?.statusCode ?? (/direct child/.test(error?.message) ? 404 : 500);
    if (status >= 500) console.error("[agency/reports/config PUT]", error);
    return NextResponse.json({
      error: error instanceof ZodError ? error.flatten() : status >= 500 ? "Failed to save report config" : error.message,
    }, { status });
  }
}