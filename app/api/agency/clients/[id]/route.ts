import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  clientStatus: z.enum(["active", "archived"]).optional(),
});

/** PATCH /api/agency/clients/[id] — rename or archive a client team */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const clientId = parseInt(params.id, 10);
    if (isNaN(clientId)) return NextResponse.json({ error: "Invalid client ID" }, { status: 400 });

    // Verify the client belongs to this agency
    const [clientTeam] = await db
      .select({ id: teams.id, parentTeamId: teams.parentTeamId, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, clientId), eq(teams.parentTeamId, teamId), isNull(teams.deletedAt)))
      .limit(1);

    if (!clientTeam) {
      return NextResponse.json({ error: "Client team not found or access denied" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    if (!parsed.data.name && !parsed.data.clientStatus) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const [updated] = await db
      .update(teams)
      .set({
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.clientStatus ? { clientStatus: parsed.data.clientStatus } : {}),
        updatedAt: new Date(),
      })
      .where(eq(teams.id, clientId))
      .returning({ id: teams.id, name: teams.name, clientStatus: teams.clientStatus });

    return NextResponse.json({ client: updated });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agency/clients PATCH]", err);
    return NextResponse.json({ error: "Failed to update client team" }, { status: 500 });
  }
}

/** POST /api/agency/clients/[id]/invite — invite a user as client_viewer to a client team */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ error: "Use /api/agency/clients/[id]/invite for invites" }, { status: 405 });
}
