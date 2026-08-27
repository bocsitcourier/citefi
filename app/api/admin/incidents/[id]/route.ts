import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/auth";
import {
  assignIncident,
  changeIncidentStatus,
  getIncidentDetail,
} from "@/lib/incident-intelligence/service";

const idSchema = z.string().uuid();
const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    status: z.enum(["open", "acknowledged", "resolved", "ignored"]),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("assign"),
    assigneeUserId: z.number().int().positive(),
    note: z.string().trim().max(700).optional(),
  }),
]);

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
    const detail = await getIncidentDetail(id);
    if (!detail) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to fetch incident" }, { status: error?.statusCode || 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actorUserId = await requireAdmin(req);
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
    const parsed = actionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid incident action", details: parsed.error.errors }, { status: 400 });
    }
    const updated = parsed.data.action === "assign"
      ? await assignIncident({ incidentId: id, actorUserId, ...parsed.data })
      : await changeIncidentStatus({
        incidentId: id,
        actorUserId,
        status: parsed.data.status,
        note: parsed.data.note,
      });
    if (!updated) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update incident" }, { status: error?.statusCode || 500 });
  }
}

export async function DELETE() {
  return NextResponse.json(
    { error: "Incidents and their audit history cannot be deleted." },
    { status: 405, headers: { Allow: "GET, PATCH" } },
  );
}