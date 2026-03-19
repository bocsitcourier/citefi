import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { factStore } from "@/lib/fact-store";
import { requireTeamMember } from "@/lib/api/auth";

const updateFactSchema = z.object({
  factText: z.string().optional(),
  sourceUrl: z.string().url().optional().nullable(),
  sourceExcerpt: z.string().optional(),
  confidence: z.number().min(0).max(100).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  status: z.enum(["active", "expired", "revoked", "pending_review"]).optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  changeReason: z.string().optional(),
});

const revokeFactSchema = z.object({
  reason: z.string().min(1, "Reason is required"),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;
    const factId = parseInt(id, 10);

    if (isNaN(factId)) {
      return NextResponse.json({ error: "Invalid fact ID" }, { status: 400 });
    }

    const fact = await factStore.getFactById(factId, teamId);
    
    if (!fact) {
      return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }

    const history = await factStore.getFactHistory(factId, teamId);

    return NextResponse.json({
      success: true,
      data: {
        fact,
        history,
      },
    });
  } catch (error) {
    console.error("[Facts API] Get error:", error);
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get fact" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id } = await params;
    const factId = parseInt(id, 10);

    if (isNaN(factId)) {
      return NextResponse.json({ error: "Invalid fact ID" }, { status: 400 });
    }

    const body = await request.json();
    const validated = updateFactSchema.parse(body);

    const updatedFact = await factStore.updateFact(factId, teamId, {
      ...validated,
      changedBy: userId,
      expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : validated.expiresAt === null ? null : undefined,
    });

    if (!updatedFact) {
      return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: updatedFact,
    });
  } catch (error) {
    console.error("[Facts API] Update error:", error);
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update fact" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const { id } = await params;
    const factId = parseInt(id, 10);

    if (isNaN(factId)) {
      return NextResponse.json({ error: "Invalid fact ID" }, { status: 400 });
    }

    const body = await request.json();
    const validated = revokeFactSchema.parse(body);

    const revoked = await factStore.revokeFact(
      factId,
      teamId,
      validated.reason,
      userId
    );

    if (!revoked) {
      return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: "Fact revoked successfully",
    });
  } catch (error) {
    console.error("[Facts API] Revoke error:", error);
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke fact" },
      { status: 500 }
    );
  }
}
