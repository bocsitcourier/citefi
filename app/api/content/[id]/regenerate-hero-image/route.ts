import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles, articleAssets, jobBatches } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import { generateSingleImage } from "@/lib/gemini-image-generator";
import { uploadMedia } from "@/lib/storage";
import { createImageBrandLockPromptSegment } from "@/lib/branding";
import { requireTeamMember } from "@/lib/api/auth";

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
    const dataUrl = await generateSingleImage(enhancedPrompt);

    if (!dataUrl) {
      return NextResponse.json(
        { error: "Failed to generate image" },
        { status: 500 }
      );
    }

    console.log(`  📥 Extracting image from data URL...`);

    // Extract base64 data from data URL
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");
    console.log(`  📥 Image size: ${(imageBuffer.length / 1024).toFixed(2)} KB`);

    // **ATOMIC OPERATION**: Upload new image FIRST, then delete old one
    // This prevents data loss if upload fails
    console.log(`  ☁️  Uploading to permanent storage...`);
    const permanentUrl = await uploadMedia({
      fileData: imageBuffer,
      fileName: `article-${articleId}-hero-regenerated.png`,
      contentType: "image/png",
      assetType: "image",
      articleId,
      altText: `Hero image - ${prompt.slice(0, 100)}`,
      metadata: {
        ...heroAsset[0].metadataJson,
        regeneratedAt: new Date().toISOString(),
        model: "gemini-2.5-flash-image",
        originalPrompt: prompt,
      },
    });

    // Verify upload succeeded before proceeding
    if (!permanentUrl) {
      return NextResponse.json(
        { error: "Failed to upload image to storage" },
        { status: 500 }
      );
    }

    // CRITICAL: Delete old hero image with team filter (AFTER successful upload)
    await db.delete(articleAssets).where(
      and(
        eq(articleAssets.id, heroAsset[0].id),
        eq(articleAssets.teamId, teamId) // CRITICAL TEAM FILTER ON DELETE
      )
    );

    // CRITICAL: Update article's heroImageUrl with team filter
    await db
      .update(articles)
      .set({ heroImageUrl: permanentUrl })
      .where(
        and(
          eq(articles.id, articleId),
          eq(articles.teamId, teamId) // CRITICAL TEAM FILTER ON UPDATE
        )
      );

    console.log(`✅ Hero image regenerated successfully: ${permanentUrl}`);
    console.log(`✅ Article heroImageUrl updated to new image`);

    return NextResponse.json({
      success: true,
      newImageUrl: permanentUrl,
      message: "Hero image regenerated successfully",
    });
  } catch (error) {
    console.error("Error regenerating hero image:", error);
    return NextResponse.json(
      { error: "Failed to regenerate hero image" },
      { status: 500 }
    );
  }
}
