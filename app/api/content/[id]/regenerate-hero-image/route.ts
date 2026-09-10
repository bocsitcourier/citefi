import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, articleAssets, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { generateSingleImage } from "@/lib/gemini-image-generator";
import { uploadMedia } from "@/lib/storage";
import { createImageBrandLockPromptSegment } from "@/lib/branding";
import { withAuthenticatedTeamContext } from "@/lib/api/auth";
import { runDirectImageOperation } from "@/lib/direct-image-operation";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // CRITICAL: Verify authentication and get team context
    return await withAuthenticatedTeamContext(request, async (auth) => {
      const { teamId, userId } = auth;

    const { id } = await context.params;
    const articleId = parseInt(id);
    
    if (isNaN(articleId)) {
      return NextResponse.json(
        { error: "Invalid article ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    // CRITICAL: Check if article exists and belongs to user's team
    const [article] = await db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // TEAM ISOLATION
        )
      );

    if (!article) {
      return NextResponse.json(
        { error: "Article not found or access denied" },
        { status: 404 }
      );
    }
    const articleTeamId = article.teamId;
    if (articleTeamId == null || !Number.isInteger(articleTeamId) || articleTeamId <= 0) {
      throw new Error(`Article ${articleId} is missing a validated teamId`);
    }

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
          message: "This batch was created without a business name. Image regeneration requires a valid business name to prevent AI hallucination of company names in images. Please update the batch business name first."
        },
        { status: 400 }
      );
    }
    
    const businessName = batch.businessName;
    
    // DEFENSIVE: Find the first/hero image for this article with team check
    const heroAsset = await db
      .select()
      .from(articleAssets)
      .where(
        and(
          eq(articleAssets.articleId, articleId),
          eq(articleAssets.teamId, teamId) // DEFENSIVE TEAM FILTER
        )
      )
      .limit(1);

    if (!heroAsset || heroAsset.length === 0) {
      return NextResponse.json(
        { error: "No hero image found for this article" },
        { status: 404 }
      );
    }

    // Apply IMAGE-SPECIFIC brand lock to user's custom prompt
    const enhancedPrompt = businessName 
      ? `${prompt}\n\n${createImageBrandLockPromptSegment(businessName)}`
      : prompt;

    // Generate new image using Gemini 2.5 Flash Image with image-specific brand lock
    console.log(`🎨 Regenerating hero image for article ${articleId}${businessName ? ` with image brand lock: "${businessName}"` : ''}...`);
    console.log(`   Prompt: ${prompt.slice(0, 100)}...`);
    const permanentUrl = await runDirectImageOperation({
      teamId,
      userId,
      resourceType: "article_hero",
      resourceId: articleId,
      resourceVersion: article.heroImageUrl ?? heroAsset[0]!.storageUrl,
      requestKey: request.headers.get("x-idempotency-key"),
      generate: async () => {
        const dataUrl = await generateSingleImage(enhancedPrompt, {
          teamId: articleTeamId,
          articleId,
          resourceType: "article",
          resourceId: articleId,
        });
        if (!dataUrl) throw new Error("Gemini rejected image generation before returning a paid result");
        return Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
      },
      persist: async (imageBuffer) => {
        const uploadedUrl = await uploadMedia({
          fileData: imageBuffer,
          fileName: `article-${articleId}-hero-regenerated.png`,
          contentType: "image/png",
          assetType: "image",
          articleId,
          altText: `Hero image - ${prompt.slice(0, 100)}`,
          metadata: {
            ...(heroAsset[0]?.metadataJson as object | undefined),
            regeneratedAt: new Date().toISOString(),
            model: "gemini-2.5-flash-image",
            originalPrompt: prompt,
          },
        });
        if (!uploadedUrl) throw new Error("Failed to upload generated image");
        const linked = await db.transaction(async (tx) => {
          await tx.delete(articleAssets).where(and(
            eq(articleAssets.id, heroAsset[0]!.id),
            eq(articleAssets.teamId, teamId),
          ));
          return tx.update(articles)
            .set({ heroImageUrl: uploadedUrl })
            .where(and(eq(articles.id, articleId), eq(articles.teamId, teamId)))
            .returning({ id: articles.id });
        });
        if (!linked[0]) throw new Error("Generated hero image could not be linked to its article");
        return uploadedUrl;
      },
    });

    console.log(`✅ Hero image regenerated successfully: ${permanentUrl}`);
    console.log(`✅ Article heroImageUrl updated to new image`);

    return NextResponse.json({
      success: true,
      newImageUrl: permanentUrl,
      message: "Hero image regenerated successfully",
    });
      });
  } catch (error: any) {
    console.error("Error regenerating hero image:", error);
    return NextResponse.json(
      { error: "Failed to regenerate hero image", code: error?.code, ...(error?.details ?? {}) },
      { status: error?.statusCode || 500 }
    );
  }
}
