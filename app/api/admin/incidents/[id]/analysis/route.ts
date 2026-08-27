import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/auth";
import { getIncidentDetail } from "@/lib/incident-intelligence/service";
import {
  getOrCreateIncidentAnalysis,
  refreshIncidentAnalysis,
  type IncidentEvidence,
} from "@/lib/incident-intelligence/ai-analysis";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actorUserId = await requireAdmin(req);
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const parsed = z.object({ refresh: z.boolean().optional().default(false) }).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid analysis request" }, { status: 400 });
    const detail = await getIncidentDetail(id);
    if (!detail) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    const evidence: IncidentEvidence[] = detail.evidence.map((item) => ({
      id: item.id,
      occurredAt: new Date(item.occurredAt).toISOString(),
      message: item.message,
      stack: item.stack ?? undefined,
      metadata: item.metadata,
    }));
    const args = { incidentId: id, evidenceVersion: detail.incident.evidenceVersion, evidence, actorUserId };
    const analysis = parsed.data.refresh
      ? await refreshIncidentAnalysis(args)
      : await getOrCreateIncidentAnalysis(args);
    return NextResponse.json({
      analysis,
      evidenceVersion: detail.incident.evidenceVersion,
      advisory: true,
    });
  } catch (error: any) {
    const status = error?.statusCode === 429 ? 429 : (error?.statusCode >= 400 && error?.statusCode < 500 ? error.statusCode : 500);
    return NextResponse.json(
      { error: status === 429 ? "Incident analysis is temporarily unavailable. Please try again later." : "Failed to analyze incident" },
      { status },
    );
  }
}