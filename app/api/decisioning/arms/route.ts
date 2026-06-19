import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember, requireTeamAdmin } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { variantArms } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const createArmSchema = z.object({
  contentType: z.enum(["article", "social", "social_post", "podcast", "video", "image"]),
  armName: z.enum(["treatment", "holdout", "exploration"]).default("treatment"),
  allocationPct: z.number().int().min(0).max(100).default(90),
  baselinePatternIds: z.array(z.number().int().positive()).default([]),
});

const updateArmSchema = z.object({
  allocationPct: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  baselinePatternIds: z.array(z.number().int().positive()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(req);
    const url = new URL(req.url);
    const contentType = url.searchParams.get("contentType");

    const conditions = contentType
      ? and(eq(variantArms.teamId, teamId), eq(variantArms.contentType, contentType))
      : eq(variantArms.teamId, teamId);

    const arms = await db
      .select()
      .from(variantArms)
      .where(conditions)
      .orderBy(variantArms.createdAt);

    return NextResponse.json({ arms });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisioning/arms GET]", err);
    return NextResponse.json({ error: "Failed to fetch variant arms" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const body = await req.json().catch(() => ({}));
    const parsed = createArmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const [arm] = await db
      .insert(variantArms)
      .values({ teamId, ...parsed.data })
      .returning();

    return NextResponse.json({ arm }, { status: 201 });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisioning/arms POST]", err);
    return NextResponse.json({ error: "Failed to create variant arm" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { teamId } = await requireTeamAdmin(req);
    const url = new URL(req.url);
    const idStr = url.searchParams.get("id");
    const armId = idStr ? parseInt(idStr) : NaN;
    if (isNaN(armId)) {
      return NextResponse.json({ error: "id query param required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = updateArmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
    }

    const existing = await db
      .select({ id: variantArms.id })
      .from(variantArms)
      .where(and(eq(variantArms.id, armId), eq(variantArms.teamId, teamId)))
      .limit(1);

    if (existing.length === 0) {
      return NextResponse.json({ error: "Arm not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(variantArms)
      .set(parsed.data)
      .where(and(eq(variantArms.id, armId), eq(variantArms.teamId, teamId)))
      .returning();

    return NextResponse.json({ arm: updated });
  } catch (err: any) {
    const status = err.statusCode ?? err.status;
    if (status === 401 || status === 403) {
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[decisioning/arms PATCH]", err);
    return NextResponse.json({ error: "Failed to update variant arm" }, { status: 500 });
  }
}
