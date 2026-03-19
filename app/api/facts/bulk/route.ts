import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { factStore } from "@/lib/fact-store";
import { requireTeamMember } from "@/lib/api/auth";

const bulkCreateFactSchema = z.object({
  facts: z.array(z.object({
    factText: z.string().min(1, "Fact text is required"),
    entityType: z.string().optional(),
    entityName: z.string().optional(),
    sourceType: z.enum(["website", "document", "api", "user_input", "verified_database"]),
    sourceUrl: z.string().url().optional().nullable(),
    sourceExcerpt: z.string().optional(),
    verifiedBy: z.string().default("user_input"),
    confidence: z.number().min(0).max(100).optional().default(80),
    expiresAt: z.string().datetime().optional().nullable(),
    tags: z.array(z.string()).optional(),
    category: z.string().optional(),
  })).min(1, "At least one fact is required").max(100, "Maximum 100 facts per request"),
});

export async function POST(request: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const body = await request.json();
    const validated = bulkCreateFactSchema.parse(body);

    const inputs = validated.facts.map(fact => ({
      teamId,
      ...fact,
      verifierId: userId,
      expiresAt: fact.expiresAt ? new Date(fact.expiresAt) : undefined,
    }));

    const createdFacts = await factStore.bulkCreateFacts(inputs);

    return NextResponse.json({
      success: true,
      data: {
        created: createdFacts.length,
        facts: createdFacts,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[Facts API] Bulk create error:", error);
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
      { error: error instanceof Error ? error.message : "Failed to bulk create facts" },
      { status: 500 }
    );
  }
}
