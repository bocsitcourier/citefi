import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { decisionPolicies } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { createPolicy } from "@/lib/bayesian-decision-service";
import { z } from "zod";

const createPolicySchema = z.object({
  contentType: z.enum(["article", "social_post"]).default("article"),
  objective: z.string().max(50).default("maximize_conversions"),
  explorationRate: z.number().min(0).max(1).default(0.1),
  holdoutPercent: z.number().min(0).max(0.5).default(0.1),
});

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const policies = await db
      .select()
      .from(decisionPolicies)
      .where(eq(decisionPolicies.teamId, teamId))
      .orderBy(decisionPolicies.createdAt);
    return NextResponse.json({ policies });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/policies GET]", err);
    return NextResponse.json({ error: "Failed to fetch policies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const body = await req.json().catch(() => ({}));
    const parsed = createPolicySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const policy = await createPolicy({ teamId, ...parsed.data });
    return NextResponse.json({ policy }, { status: 201 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisions/policies POST]", err);
    return NextResponse.json({ error: "Failed to create policy" }, { status: 500 });
  }
}
