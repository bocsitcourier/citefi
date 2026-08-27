import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/auth";
import { getIncidentReport } from "@/lib/incident-intelligence/service";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const window = new URL(req.url).searchParams.get("window") === "24h" ? "24h" : "7d";
    return NextResponse.json(await getIncidentReport(window));
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to build incident report" },
      { status: error?.statusCode || 500 },
    );
  }
}