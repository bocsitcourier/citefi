import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles, jobBatches } from "@/shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { addImageGenerationJob } from "@/lib/queue";

interface ImagePromptGenerationResult {
  imagePrompts: string[];
}

async function generateImagePromptsForArticle(
  title: string,
  articleContent: string,
  businessName?: string,
  geographicFocus?: string
): Promise<string[]> {
  const { GoogleGenAI } = await import("@google/genai");
  const { throttledGeminiRequest } = await import("@/lib/gemini");
  
  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  
  const prompt = `Generate 3 detailed DALL-E image prompts for an article titled "${title}".

Article excerpt: ${articleContent.slice(0, 1000)}...

${businessName ? `Business Name: ${businessName}` : ''}
${geographicFocus ? `Geographic Focus: ${geographicFocus}` : ''}

Requirements for each image prompt:
1. HERO IMAGE: Professional, eye-catching image representing the main topic
2. SUPPORTING IMAGE: Documentary-style image showing the service/activity in action
3. INFOGRAPHIC: Visual representation of key data or process

Each prompt should be:
- 50-100 words
- Highly detailed and specific
- Include lighting, composition, and style details
- ${businessName ? `Feature "${businessName}" branding naturally (uniforms, vehicles, signage)` : ''}
- ${geographicFocus ? `Set in ${geographicFocus} with recognizable local elements` : ''}

Return ONLY valid JSON in this format:
{
  "imagePrompts": [
    "Detailed prompt for hero image...",
    "Detailed prompt for supporting image...",
    "Detailed prompt for infographic..."
  ]
}`;

  const result = await throttledGeminiRequest(() => genAI.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          imagePrompts: {
            type: "array",
            items: { type: "string" },
            description: "3 detailed DALL-E image prompts"
          }
        },
        required: ["imagePrompts"]
      }
    }
  }));

  let responseText = result.text || "";
  responseText = responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  
  const parsed = JSON.parse(responseText) as ImagePromptGenerationResult;
  return parsed.imagePrompts || [];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { teamId } = await requireTeamMember(request);
    const { id } = await params;
    const batchId = parseInt(id);

    if (isNaN(batchId)) {
      return NextResponse.json({ error: "Invalid batch ID" }, { status: 400 });
    }

    const [batch] = await db
      .select()
      .from(jobBatches)
      .where(and(eq(jobBatches.id, batchId), eq(jobBatches.teamId, teamId)))
      .limit(1);

    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const businessName = batch.businessName || undefined;
    const geographicFocus = batch.geographicFocus || undefined;

    if (!businessName || businessName.trim().length === 0) {
      return NextResponse.json({ 
        error: "Cannot regenerate images: batch is missing business name (required for brand safety)" 
      }, { status: 400 });
    }

    const completedStatuses = ["COMPLETE", "GPT4_ENHANCED", "GEMINI_COMPLETE", "CHATGPT_REVIEWED"];
    
    const articlesWithoutImages = await db
      .select({
        id: articles.id,
        title: articles.chosenTitle,
        content: articles.finalHtmlContent,
        imagePrompts: articles.imagePromptsJson,
        heroImageUrl: articles.heroImageUrl,
      })
      .from(articles)
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, completedStatuses),
          sql`(${articles.heroImageUrl} IS NULL OR ${articles.heroImageUrl} = '')`
        )
      );

    if (articlesWithoutImages.length === 0) {
      return NextResponse.json({
        message: "All articles in this batch already have images",
        regenerated: 0
      });
    }

    let regeneratedCount = 0;
    const errors: string[] = [];

    for (const article of articlesWithoutImages) {
      try {
        console.log(`🖼️ Regenerating image prompts for article ${article.id}: ${article.chosenTitle}`);
        
        const imagePrompts = await generateImagePromptsForArticle(
          article.chosenTitle || "Untitled",
          article.content || "",
          businessName,
          geographicFocus
        );

        if (imagePrompts.length > 0) {
          await db
            .update(articles)
            .set({ imagePromptsJson: imagePrompts })
            .where(eq(articles.id, article.id));

          await addImageGenerationJob({
            articleId: article.id,
            batchId,
            imagePrompts,
            businessName,
          });

          console.log(`✅ Queued ${imagePrompts.length} images for article ${article.id}`);
          regeneratedCount++;
        } else {
          errors.push(`Article ${article.id}: No image prompts generated`);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ Failed to regenerate images for article ${article.id}:`, errorMsg);
        errors.push(`Article ${article.id}: ${errorMsg}`);
      }
    }

    return NextResponse.json({
      message: `Regenerated images for ${regeneratedCount} of ${articlesWithoutImages.length} articles`,
      regenerated: regeneratedCount,
      total: articlesWithoutImages.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error("Error regenerating images:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
