import { NextRequest, NextResponse } from "next/server";
import { requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { teams, teamMembers } from "@/shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";
import { upsertClientBrandProfile } from "@/lib/client-brand-profile-service";
import { addIntelligenceResearchJob } from "@/lib/queue";

const MAX_CLIENTS_PER_AGENCY = 25;

async function getAgencyTeam(teamId: number) {
  const [team] = await db
    .select({ id: teams.id, name: teams.name, billingPlan: teams.billingPlan })
    .from(teams)
    .where(eq(teams.id, teamId));
  return team ?? null;
}

/** GET /api/agency/clients — list all client teams (active + archived) for the current agency */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);

    const agencyTeam = await getAgencyTeam(teamId);
    if (!agencyTeam) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    if (agencyTeam.billingPlan !== "agency") {
      return NextResponse.json(
        { error: "Agency plan required to access client teams", upgradeUrl: "/settings/billing" },
        { status: 403 }
      );
    }

    const clients = await db
      .select({
        id: teams.id,
        publicId: teams.publicId,
        name: teams.name,
        clientStatus: teams.clientStatus,
        createdAt: teams.createdAt,
      })
      .from(teams)
      .where(and(eq(teams.parentTeamId, teamId), isNull(teams.deletedAt)))
      .orderBy(teams.createdAt);

    return NextResponse.json({
      clients,
      agencyTeam: { id: agencyTeam.id, name: agencyTeam.name },
    });
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[agency/clients GET]", err);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}

const createClientSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  /** Optional: if provided, intelligence research is auto-triggered on team creation */
  websiteUrl: z.string().url().optional().or(z.literal("")),
  /** Optional company name override (defaults to team name) */
  companyName: z.string().max(255).optional(),
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

    // Auto-trigger intelligence research if website URL was provided at creation time
    let intelligenceJobId: string | null = null;
    const websiteUrl = parsed.data.websiteUrl;
    if (websiteUrl && websiteUrl.length > 0) {
      const resolvedName = parsed.data.companyName?.trim() || parsed.data.name;
      try {
        await upsertClientBrandProfile(newTeam.id, websiteUrl, resolvedName);
        intelligenceJobId = await addIntelligenceResearchJob({
          teamId: newTeam.id,
          websiteUrl,
          companyName: resolvedName,
        });
        console.log(`🧠 Auto-triggered intelligence research for new client team ${newTeam.id} (${resolvedName}): job ${intelligenceJobId}`);
      } catch (intelErr) {
        // Non-fatal — client team is still created successfully
        console.error(`[agency/clients] Intelligence auto-trigger failed for team ${newTeam.id}:`, intelErr);
      }
    }

    return NextResponse.json(
      { client: newTeam, intelligenceJobId },
      { status: 201 }
    );
  } catch (err: any) {
    const httpStatus = err.statusCode ?? err.status;
    if (httpStatus === 401 || httpStatus === 403) {
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    console.error("[agency/clients POST]", err);
    return NextResponse.json({ error: "Failed to create client team" }, { status: 500 });
  }
}
