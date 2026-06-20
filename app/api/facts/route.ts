import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { factStore } from "@/lib/fact-store";
import { requireTeamMember } from "@/lib/api/auth";

const createFactSchema = z.object({
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
});

export async function GET(request: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const searchParams = request.nextUrl.searchParams;

    const query = {
      teamId,
      entityType: searchParams.get("entityType") || undefined,
      entityName: searchParams.get("entityName") || undefined,
      category: searchParams.get("category") || undefined,
      minConfidence: searchParams.get("minConfidence") ? parseInt(searchParams.get("minConfidence")!, 10) : undefined,
      includeExpired: searchParams.get("includeExpired") === "true",
      limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 100,
    };

    const factPack = await factStore.queryFacts(query);

    return NextResponse.json({
      success: true,
      data: factPack,
    });
  } catch (error: any) {
    console.error("[Facts API] Error:", error);
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to query facts" },
      { status: error?.statusCode || 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { teamId, userId } = await requireTeamMember(request);
    const body = await request.json();
    const validated = createFactSchema.parse(body);

    const fact = await factStore.createFact({
      teamId,
      ...validated,
      verifierId: userId,
      expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: fact,
    }, { status: 201 });
  } catch (error: any) {
    console.error("[Facts API] Create error:", error);
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
      { error: error instanceof Error ? error.message : "Failed to create fact" },
      { status: error?.statusCode || 500 }
    );
  }
}
