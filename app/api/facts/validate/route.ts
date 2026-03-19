import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateExistingContent } from "@/lib/verified-content-generator";
import { requireTeamMember } from "@/lib/api/auth";

const validateContentSchema = z.object({
  contentType: z.enum(["article", "social", "video", "podcast"]),
  contentId: z.number().optional(),
  content: z.string().min(1, "Content is required"),
  entityTypes: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  minConfidence: z.number().min(0).max(100).optional().default(70),
});

export async function POST(request: NextRequest) {
  try {
    const { teamId } = await requireTeamMember(request);
    const body = await request.json();
    const validated = validateContentSchema.parse(body);

    const validationResult = await validateExistingContent(validated.content, {
      teamId,
      contentType: validated.contentType,
      contentId: validated.contentId,
      entityTypes: validated.entityTypes,
      categories: validated.categories,
      minConfidence: validated.minConfidence,
    });

    return NextResponse.json({
      success: true,
      data: {
        isValid: validationResult.isValid,
        safetyScore: validationResult.safetyScore,
        totalClaims: validationResult.validatedClaims.length + validationResult.rejectedClaims.length,
        approvedClaims: validationResult.validatedClaims.length,
        rejectedClaims: validationResult.rejectedClaims.length,
        insufficientDataClaims: validationResult.insufficientDataClaims.length,
        gapReport: validationResult.gapReport,
        claims: {
          approved: validationResult.validatedClaims.map(c => ({
            text: c.claimText,
            factIds: c.factIds,
            confidence: c.confidence,
            claimClass: c.claimClass,
          })),
          rejected: validationResult.rejectedClaims.map(c => ({
            text: c.claimText,
            factIds: c.factIds,
            confidence: c.confidence,
            claimClass: c.claimClass,
          })),
        },
      },
    });
  } catch (error) {
    console.error("[Facts API] Validate error:", error);
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
      { error: error instanceof Error ? error.message : "Failed to validate content" },
      { status: 500 }
    );
  }
}
