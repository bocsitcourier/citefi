import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, teamMembers } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";

const MAX_CLIENTS_PER_AGENCY = 25;

async function getAgencyTeam(teamId: number) {
  const [team] = await db
    .select({ id: teams.id, name: teams.name, billingPlan: teams.billingPlan, parentTeamId: teams.parentTeamId })
    .from(teams)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .limit(1);
  return team ?? null;
}

/** GET /api/agency/clients — list all client teams under the current agency team */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const agencyTeam = await getAgencyTeam(teamId);

    if (!agencyTeam) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (agencyTeam.billingPlan !== "agency") {
      return NextResponse.json(
        { error: "Agency plan required to manage client teams", upgradeUrl: "/settings/billing" },
        { status: 403 }
      );
    }

    const clients = await db
      .select({
        id: teams.id,
        publicId: teams.publicId,
        name: teams.name,
        clientStatus: teams.clientStatus,
        billingPlan: teams.billingPlan,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(and(eq(teams.parentTeamId, teamId), isNull(teams.deletedAt)))
      .orderBy(teams.createdAt);

    return NextResponse.json({ clients, agencyTeam: { id: agencyTeam.id, name: agencyTeam.name } });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agency/clients GET]", err);
    return NextResponse.json({ error: "Failed to list clients" }, { status: 500 });
  }
}

const createClientSchema = z.object({
  name: z.string().min(2).max(100).trim(),
});

/** POST /api/agency/clients — create a new client team under the current agency */
export async function POST(req: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamAdmin(req);
    const agencyTeam = await getAgencyTeam(teamId);

    if (!agencyTeam) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    if (agencyTeam.billingPlan !== "agency") {
      return NextResponse.json(
        { error: "Agency plan required to create client teams", upgradeUrl: "/settings/billing" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = createClientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    // Enforce client limit
    const existing = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.parentTeamId, teamId), eq(teams.clientStatus, "active"), isNull(teams.deletedAt)));

    if (existing.length >= MAX_CLIENTS_PER_AGENCY) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_CLIENTS_PER_AGENCY} active client teams allowed per agency` },
        { status: 422 }
      );
    }

    // Create the client team
    const [newTeam] = await db
      .insert(teams)
      .values({
        name: parsed.data.name,
        createdBy: userId,
        billingPlan: "free",
        billingStatus: "active",
        parentTeamId: teamId,
        clientStatus: "active",
      })
      .returning({
        id: teams.id,
        publicId: teams.publicId,
        name: teams.name,
        clientStatus: teams.clientStatus,
        createdAt: teams.createdAt,
      });

    // Auto-add the creating agency admin as an admin of the client team
    await db.insert(teamMembers).values({
      teamId: newTeam.id,
      userId,
      role: "admin",
    });

    return NextResponse.json({ client: newTeam }, { status: 201 });
  } catch (err: any) {
    if (err.status === 401 || err.status === 403) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[agency/clients POST]", err);
    return NextResponse.json({ error: "Failed to create client team" }, { status: 500 });
  }
}
