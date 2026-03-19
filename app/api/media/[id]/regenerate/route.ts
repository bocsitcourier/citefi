import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articleAssets, articles, jobBatches } from "@/shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateSingleImage } from "@/lib/gemini-image-generator";
import { uploadMedia } from "@/lib/storage";
import { createImageBrandLockPromptSegment } from "@/lib/branding";
import { requireTeamMember } from "@/lib/api/auth";

const regenerateSchema = z.object({
  prompt: z.string().min(10, "Prompt must be at least 10 characters"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, teamId } = await requireTeamMember(request);
    const { id } = await params;
    const assetId = parseInt(id);

    if (isNaN(assetId)) {
      return NextResponse.json(
        { error: "Invalid asset ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { prompt } = regenerateSchema.parse(body);

    // Get the asset details
    const [asset] = await db
      .select()
      .from(articleAssets)
      .where(eq(articleAssets.id, assetId));

    if (!asset) {
      return NextResponse.json(
        { error: "Asset not found" },
        { status: 404 }
      );
    }

    if (asset.assetType !== 'image') {
      return NextResponse.json(
        { error: "Can only regenerate images" },
        { status: 400 }
      );
    }

    // Get article to retrieve batch and businessName for brand lock
    let businessName: string | undefined;
    if (asset.articleId) {
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, asset.articleId));
      
      if (article?.batchId) {
        const [batch] = await db
          .select()
          .from(jobBatches)
          .where(eq(jobBatches.id, article.batchId));
        
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
        
        businessName = batch.businessName;
      }
    }

    // Apply IMAGE-SPECIFIC brand lock to user's custom prompt
    const enhancedPrompt = businessName 
      ? `${prompt}\n\n${createImageBrandLockPromptSegment(businessName)}`
      : prompt;

    console.log(`🔄 Regenerating image ${assetId}${businessName ? ` with image brand lock: "${businessName}"` : ''}`);

    // Generate new image with Gemini 2.5 Flash Image with image-specific brand lock
    const dataUrl = await generateSingleImage(enhancedPrompt);
    if (!dataUrl) {
      throw new Error("No image returned from Gemini");
    }

    console.log(`✅ Gemini image generated, extracting data...`);

    // Extract base64 data from data URL
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");
    
    // Generate new filename
    const timestamp = Date.now();
    const filename = `regenerated-${timestamp}.png`;
    
    // Determine storage path based on article ID
    let storagePath: string;
    if (asset.articleId) {
      storagePath = `public/article-${asset.articleId}/images/${filename}`;
    } else {
      storagePath = `public/media/${filename}`;
    }

    // Upload to permanent storage
    console.log(`📤 Uploading to storage: ${storagePath}`);
    const permanentUrl = await uploadMedia({
      buffer: Buffer.from(imageBuffer),
      key: storagePath,
      contentType: "image/png"
    });

    console.log(`✅ Uploaded to permanent storage: ${permanentUrl}`);

    // Store the old URL for replacement in article HTML
    const oldUrl = asset.storageUrl;

    // Update the asset record
    const [updatedAsset] = await db
      .update(articleAssets)
      .set({
        storageUrl: permanentUrl,
        imagePromptUsed: prompt,
        metadataJson: {
          ...asset.metadataJson,
          regeneratedAt: new Date().toISOString(),
          originalPrompt: asset.imagePromptUsed,
        }
      })
      .where(eq(articleAssets.id, assetId))
      .returning();

    // If this image belongs to an article, update the article HTML
    if (asset.articleId) {
      const [article] = await db
        .select()
        .from(articles)
        .where(eq(articles.id, asset.articleId));

      if (article) {
        let updatedFields: any = {};

        // Update hero image URL if this is the hero image
        if (article.heroImageUrl === oldUrl) {
          updatedFields.heroImageUrl = permanentUrl;
          console.log(`✅ Updating article ${asset.articleId} hero image URL`);
        }

        // Replace old URL with new URL in article HTML content
        if (article.finalHtmlContent && article.finalHtmlContent.includes(oldUrl)) {
          updatedFields.finalHtmlContent = article.finalHtmlContent.replace(
            new RegExp(oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            permanentUrl
          );
          console.log(`✅ Replaced old image URL in article ${asset.articleId} HTML content`);
        }

        // Apply updates if any fields changed
        if (Object.keys(updatedFields).length > 0) {
          await db
            .update(articles)
            .set(updatedFields)
            .where(eq(articles.id, asset.articleId));
          
          console.log(`✅ Updated article ${asset.articleId} with new image URLs`);
        }
      }
    }

    console.log(`✅ Image ${assetId} regenerated successfully`);

    return NextResponse.json({
      success: true,
      asset: updatedAsset,
      message: "Image regenerated successfully",
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: "Invalid request data",
          details: error.errors
        },
        { status: 400 }
      );
    }

    console.error("❌ Image regeneration error:", error);
    return NextResponse.json(
      { 
        error: "Failed to regenerate image",
        message: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}
