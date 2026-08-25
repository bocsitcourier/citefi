import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTeamAdmin, runWithAuthenticatedTeamContext } from "@/lib/api/auth";
import { approveAgencyReportConfig } from "@/lib/agency-report-service";

const inputSchema = z.object({ clientTeamId: z.number().int().positive() });

export async function POST(request: NextRequest) {
  try {
    const auth = await requireTeamAdmin(request);
    const parsed = inputSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    return await runWithAuthenticatedTeamContext(auth, async () =>
      NextResponse.json({ config: await approveAgencyReportConfig(parsed.data.clientTeamId) }));
  } catch (error: any) {
    const status = error instanceof SyntaxError ? 400
      : error?.statusCode ?? (/not found|direct child/i.test(error?.message) ? 404 : 500);
    if (status >= 500) console.error("[agency/reports/config/approve POST]", error);
    return NextResponse.json({ error: status >= 500 ? "Failed to approve report config" : error.message }, { status });
  }
}