import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { decisionPolicies } from "@/shared/schema";
import { and, eq } from "drizzle-orm";
import { selectArm } from "@/lib/bayesian-decision-service";
import { z } from "zod";

const selectSchema = z.object({
  policyId: z.number().int().positive(),
  visitorId: z.string().min(1).max(256),
});

/**
 * POST /api/decisions/select
 * Run Thompson Sampling for a visitor against a policy.
 * Returns the selected armId (or null if visitor is in holdout).
 * Assignments are sticky — repeated calls with the same visitorId return
 * the same arm.
 */
export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const parsed = selectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const { policyId, visitorId } = parsed.data;

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

    const result = await selectArm(policyId, visitorId);
    return NextResponse.json(result);
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403 || status === 404 || status === 422) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/select POST]", err);
    return NextResponse.json({ error: "Failed to select arm" }, { status: 500 });
  }
}
