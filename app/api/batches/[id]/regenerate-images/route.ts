import { NextRequest, NextResponse } from "next/server";
import { requireTeamMember } from "@/lib/api/auth";
import { db } from "@/lib/db";
import { articles, jobBatches, ContentType } from "@/shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { addImageGenerationJob } from "@/lib/queue";
import { GEMINI_FLASH_MODEL } from "@/lib/ai-config";
import { runGenerationOrchestrator } from "@/lib/generation-orchestrator";
import { recordContentGenerated } from "@/lib/learning-integration";

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
    model: GEMINI_FLASH_MODEL,
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
    const geographicFocus = (batch as any).geographicFocus as string | undefined;

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
        chosenTitle: articles.chosenTitle,
        content: articles.finalHtmlContent,
        imagePrompts: articles.imagePromptsJson,
        heroImageUrl: articles.heroImageUrl,
      })
      .from(articles)
      .where(
        and(
          eq(articles.batchId, batchId),
          inArray(articles.articleStatus, completedStatuses),
          // Also catch articles where image generation failed and the SVG fallback placeholder was stored
          sql`(${articles.heroImageUrl} IS NULL OR ${articles.heroImageUrl} = '' OR ${articles.heroImageUrl} LIKE 'data:image/svg+xml%')`
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
          // Critic loop: review image prompt text for brand policy compliance.
          // requireJudge=false — image prompts are short visual descriptors, not long-form content.
          let finalPrompts = imagePrompts;
          try {
            const orchResult = await runGenerationOrchestrator({
              teamId,
              contentType: ContentType.IMAGE,
              contentId: article.id,
              content: imagePrompts.join('\n\n---\n\n'),
              patternsUsed: [],
              brief: { topic: article.chosenTitle ?? undefined },
              kind: "script",
              requireJudge: false,
            });
            if (orchResult.repairs > 0 && orchResult.orchestrated) {
              // Re-split on the same separator to restore the prompt array
              const repairedSplit = orchResult.content.split(/\n\n---\n\n/).map(p => p.trim()).filter(Boolean);
              if (repairedSplit.length === imagePrompts.length) {
                finalPrompts = repairedSplit;
                console.log(`🔧 Image prompts critic: ${orchResult.repairs} repair(s) applied for article ${article.id}`);
              }
            }
            // Record learning metrics for image generation path
            await recordContentGenerated(
              teamId,
              ContentType.IMAGE,
              article.id,
              [],
              orchResult.qualityScore > 0 ? orchResult.qualityScore : 75,
              { armId: orchResult.armId }
            ).catch(() => { /* non-fatal */ });
          } catch (orchErr) {
            console.warn(`[Image Regen] Orchestrator failed, continuing:`, (orchErr as Error).message);
          }

          await db
            .update(articles)
            .set({ imagePromptsJson: finalPrompts })
            .where(eq(articles.id, article.id));

          await addImageGenerationJob({
            articleId: article.id,
            batchId,
            imagePrompts: finalPrompts,
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
