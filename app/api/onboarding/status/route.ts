import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { teams, jobBatches, publishingConnections } from "@/shared/schema";
import { eq, and, isNull, count } from "drizzle-orm";
import { requireTeamAdmin } from "@/lib/api/auth";

/**
 * GET /api/onboarding/status
 * Returns the three onboarding step states for an agency team.
 * Used by the onboarding page and the first-login redirect guard.
 */
export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);

    const [team] = await db
      .select({ billingPlan: teams.billingPlan })
      .from(teams)
      .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
      .limit(1);

    if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

    // Step 1: has at least one client workspace (child team)
    const [clientCount] = await db
      .select({ n: count() })
      .from(teams)
      .where(and(eq(teams.parentTeamId, teamId), eq(teams.clientStatus, "active"), isNull(teams.deletedAt)));

    const hasClients = (clientCount?.n ?? 0) > 0;

    // Step 2: has at least one active publishing connection
    let hasPublishingConnection = false;
    try {
      const [connCount] = await db
        .select({ n: count() })
        .from(publishingConnections)
        .where(and(eq(publishingConnections.teamId, teamId), eq(publishingConnections.status, "active")));
      hasPublishingConnection = (connCount?.n ?? 0) > 0;
    } catch {
      hasPublishingConnection = false;
    }

    // Step 3: has at least one completed content batch
    const [batchCount] = await db
      .select({ n: count() })
      .from(jobBatches)
      .where(and(eq(jobBatches.teamId, teamId), eq(jobBatches.status, "COMPLETE")));

    const hasContent = (batchCount?.n ?? 0) > 0;

    const isAgency = team.billingPlan === "agency";
    const isComplete = hasClients && hasPublishingConnection && hasContent;

    return NextResponse.json({
      isAgency,
      hasClients,
      hasPublishingConnection,
      hasContent,
      isComplete,
      stepsComplete: [hasClients, hasPublishingConnection, hasContent].filter(Boolean).length,
    });
  } catch (err: any) {
    const s = err?.statusCode ?? err?.status;
    if (s === 401 || s === 403) return NextResponse.json({ error: err.message }, { status: s });
    console.error("[onboarding/status]", err);
    return NextResponse.json({ error: "Failed to load onboarding status" }, { status: 500 });
  }
}
