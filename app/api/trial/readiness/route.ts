import { NextResponse } from "next/server";
import { getTrialReadiness } from "@/lib/trial/readiness-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  const report = await getTrialReadiness();
  return NextResponse.json(report, { status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
