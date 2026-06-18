import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { decisionPolicies } from "@/shared/schema";
import { and, eq } from "drizzle-orm";
import { recordOutcome } from "@/lib/bayesian-decision-service";
import { z } from "zod";

const updateSchema = z.object({
  policyId: z.number().int().positive(),
  visitorId: z.string().min(1).max(256),
  outcome: z.enum(["impression", "conversion"]),
});

/**
 * POST /api/decisions/update
 * Record an impression or conversion outcome for a visitor's assigned arm.
 * Updates the arm's Beta posterior in a transaction.
 * Holdout visitors are silently skipped.
 */
export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { policyId, visitorId, outcome } = parsed.data;

    // Verify policy belongs to this team
    const [policy] = await db
      .select({ id: decisionPolicies.id })
      .from(decisionPolicies)
      .where(
        and(
          eq(decisionPolicies.id, policyId),
          eq(decisionPolicies.teamId, teamId)
        )
      )
      .limit(1);

    if (!policy) {
      return NextResponse.json({ error: "Policy not found" }, { status: 404 });
    }

    const result = await recordOutcome(policyId, visitorId, outcome);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403 || status === 404) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/update POST]", err);
    return NextResponse.json({ error: "Failed to record outcome" }, { status: 500 });
  }
}
