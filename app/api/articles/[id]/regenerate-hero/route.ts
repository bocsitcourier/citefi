import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, articleAssets, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { generateAndStoreHeroImage } from "@/lib/gemini-image-generator";
import { requireTeamMember } from "@/lib/api/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 90; // 90 seconds for image generation

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    const { teamId } = await requireTeamMember(request);

    const { id } = await context.params;
    const articleId = parseInt(id);

    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    // CRITICAL: Get the article filtered by team_id
    const article = await db.query.articles.findFirst({
      where: and(
        eq(articles.id, articleId),
        eq(articles.teamId, teamId) // TEAM ISOLATION
      ),
    });

    if (!article) {
      return NextResponse.json(
        { error: "Article not found or access denied" },
        { status: 404 }
      );
    }

    // DEFENSIVE: Get image prompt from article_assets with team check
    const asset = await db.query.articleAssets.findFirst({
      where: and(
        eq(articleAssets.articleId, articleId),
        eq(articleAssets.teamId, teamId) // DEFENSIVE TEAM FILTER
      ),
      columns: {
        imagePromptUsed: true,
      },
    });

    // DEFENSIVE: Get batch filtered by team_id
    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(
        and(
          eq(jobBatches.id, article.batchId || 0),
          eq(jobBatches.teamId, teamId) // DEFENSIVE TEAM FILTER
        )
      );
    
    // CRITICAL: Validate businessName before image regeneration
    if (!batch?.businessName || batch.businessName.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Business name required",
          message: "This batch was created without a business name. Hero image regeneration requires a valid business name to prevent AI hallucination of company names in images. Please update the batch business name first."
        },
        { status: 400 }
      );
    }
    
    const businessName = batch.businessName;
    
    // Use existing prompt if available, otherwise create a generic one
    const prompt = asset?.imagePromptUsed || 
      `Professional hero image for article: ${article.chosenTitle}. High quality, photorealistic, modern, relevant to the topic.`;

    console.log(`[REGENERATE_HERO] Regenerating hero for article ${articleId}${businessName ? ` with brand lock: "${businessName}"` : ''}...`);

    // Generate new hero image with brand lock
    const heroImageUrl = await generateAndStoreHeroImage(
      prompt,
      articleId,
      article.batchId || 0,
      businessName
    );

    // CRITICAL: Update article with new hero image URL with team filter
    await db
      .update(articles)
      .set({ heroImageUrl })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      );

    console.log(`[REGENERATE_HERO] Success! New URL: ${heroImageUrl}`);

    return NextResponse.json({
      success: true,
      heroImageUrl,
      message: "Hero image regenerated successfully",
    });
  } catch (error) {
    console.error("[REGENERATE_HERO] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to regenerate hero image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
